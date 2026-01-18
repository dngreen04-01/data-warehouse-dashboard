-- Cluster Unit Multipliers for Production Planning
-- Date: 2026-01-19
-- Purpose: Add unit_multiplier to product clusters for production planning analytics
-- Reference: docs/ExecPlan-ProductClusterUnitMultipliers.md - Milestone 1

-- ============================================================================
-- PHASE 1: Schema Changes
-- ============================================================================

-- 1.1 Add unit_multiplier column to dim_product_cluster
-- Default 1 means existing records represent 1 base unit per product unit
ALTER TABLE dw.dim_product_cluster
ADD COLUMN IF NOT EXISTS unit_multiplier NUMERIC(18,4) DEFAULT 1 NOT NULL;

-- 1.2 Add CHECK constraint to ensure unit_multiplier is positive
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dim_product_cluster_unit_multiplier_check'
    ) THEN
        ALTER TABLE dw.dim_product_cluster
        ADD CONSTRAINT dim_product_cluster_unit_multiplier_check
        CHECK (unit_multiplier > 0);
    END IF;
END$$;

-- 1.3 Add base_unit_label column to dim_cluster
-- Only meaningful for product clusters (e.g., "clips", "meters", "grams")
ALTER TABLE dw.dim_cluster
ADD COLUMN IF NOT EXISTS base_unit_label TEXT DEFAULT 'units';

-- 1.4 Create index for efficient cluster aggregation queries
-- Index on (cluster_id, product_id) helps with JOINs and GROUP BY cluster_id
CREATE INDEX IF NOT EXISTS idx_dim_product_cluster_cluster_product
ON dw.dim_product_cluster (cluster_id, product_id);

-- ============================================================================
-- PHASE 2: Update Existing RPCs
-- ============================================================================

-- 2.1 Update create_cluster to accept optional base_unit_label
DROP FUNCTION IF EXISTS public.create_cluster(text, text);
CREATE OR REPLACE FUNCTION public.create_cluster(
    p_label text,
    p_type text DEFAULT 'customer',
    p_base_unit_label text DEFAULT 'units'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id int;
BEGIN
    INSERT INTO dw.dim_cluster (cluster_label, cluster_type, base_unit_label)
    VALUES (p_label, p_type, p_base_unit_label)
    RETURNING cluster_id INTO v_id;
    RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_cluster(text, text, text) TO authenticated;

-- 2.2 Update get_clusters_by_type to return base_unit_label
DROP FUNCTION IF EXISTS public.get_clusters_by_type(text);
CREATE OR REPLACE FUNCTION public.get_clusters_by_type(
    p_type text
)
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    cluster_type text,
    member_count bigint,
    base_unit_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_type = 'customer' THEN
        RETURN QUERY
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.cluster_type,
            COUNT(cc.customer_id)::bigint as member_count,
            c.base_unit_label
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_customer_cluster cc ON cc.cluster_id = c.cluster_id
        WHERE c.cluster_type = 'customer' OR c.cluster_type IS NULL
        GROUP BY c.cluster_id, c.cluster_label, c.cluster_type, c.base_unit_label
        ORDER BY c.cluster_label;
    ELSE
        RETURN QUERY
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.cluster_type,
            COUNT(pc.product_id)::bigint as member_count,
            c.base_unit_label
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_product_cluster pc ON pc.cluster_id = c.cluster_id
        WHERE c.cluster_type = 'product'
        GROUP BY c.cluster_id, c.cluster_label, c.cluster_type, c.base_unit_label
        ORDER BY c.cluster_label;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_clusters_by_type(text) TO authenticated;

-- 2.3 Update manage_cluster_member to accept optional unit_multiplier for products
DROP FUNCTION IF EXISTS public.manage_cluster_member(text, text, int, text);
CREATE OR REPLACE FUNCTION public.manage_cluster_member(
    p_type text,
    p_action text,
    p_cluster_id int,
    p_entity_id text,
    p_unit_multiplier numeric DEFAULT 1
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_type = 'customer' THEN
        IF p_action = 'add' THEN
            -- Upsert: insert or update if already assigned to a different cluster
            INSERT INTO dw.dim_customer_cluster (customer_id, cluster_id)
            VALUES (p_entity_id, p_cluster_id)
            ON CONFLICT (customer_id) DO UPDATE SET cluster_id = p_cluster_id;
        ELSE
            DELETE FROM dw.dim_customer_cluster
            WHERE customer_id = p_entity_id AND cluster_id = p_cluster_id;
        END IF;
    ELSIF p_type = 'product' THEN
        IF p_action = 'add' THEN
            -- Upsert: insert or update cluster and unit_multiplier
            INSERT INTO dw.dim_product_cluster (product_id, cluster_id, unit_multiplier)
            VALUES (p_entity_id::bigint, p_cluster_id, p_unit_multiplier)
            ON CONFLICT (product_id) DO UPDATE SET
                cluster_id = p_cluster_id,
                unit_multiplier = p_unit_multiplier;
        ELSE
            DELETE FROM dw.dim_product_cluster
            WHERE product_id = p_entity_id::bigint AND cluster_id = p_cluster_id;
        END IF;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.manage_cluster_member(text, text, int, text, numeric) TO authenticated;

-- 2.4 Update get_cluster_members to return unit_multiplier for products
DROP FUNCTION IF EXISTS public.get_cluster_members(int, text);
CREATE OR REPLACE FUNCTION public.get_cluster_members(
    p_cluster_id int,
    p_type text
)
RETURNS TABLE (
    id text,
    name text,
    unit_multiplier numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_type = 'customer' THEN
        RETURN QUERY
        SELECT
            c.customer_id::text,
            c.customer_name::text,
            NULL::numeric as unit_multiplier
        FROM dw.dim_customer_cluster cc
        JOIN dw.dim_customer c ON c.customer_id = cc.customer_id
        WHERE cc.cluster_id = p_cluster_id
        ORDER BY c.customer_name;
    ELSE
        RETURN QUERY
        SELECT
            p.product_id::text,
            p.item_name::text,
            pc.unit_multiplier
        FROM dw.dim_product_cluster pc
        JOIN dw.dim_product p ON p.product_id = pc.product_id
        WHERE pc.cluster_id = p_cluster_id
        ORDER BY p.item_name;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_cluster_members(int, text) TO authenticated;

-- ============================================================================
-- PHASE 3: New RPCs
-- ============================================================================

-- 3.1 Update product unit multiplier (for editing after assignment)
CREATE OR REPLACE FUNCTION public.update_product_unit_multiplier(
    p_product_id bigint,
    p_unit_multiplier numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Validate multiplier is positive
    IF p_unit_multiplier <= 0 THEN
        RAISE EXCEPTION 'Unit multiplier must be greater than 0';
    END IF;

    UPDATE dw.dim_product_cluster
    SET unit_multiplier = p_unit_multiplier
    WHERE product_id = p_product_id;

    -- Raise notice if no rows affected (product not in any cluster)
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % is not assigned to any cluster', p_product_id;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_product_unit_multiplier(bigint, numeric) TO authenticated;

-- 3.2 Update cluster base_unit_label (for editing after creation)
CREATE OR REPLACE FUNCTION public.update_cluster_base_unit_label(
    p_cluster_id int,
    p_base_unit_label text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE dw.dim_cluster
    SET base_unit_label = p_base_unit_label,
        updated_at = timezone('utc', now())
    WHERE cluster_id = p_cluster_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cluster % not found', p_cluster_id;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_cluster_base_unit_label(int, text) TO authenticated;

-- ============================================================================
-- PHASE 4: Verification Queries (for manual testing)
-- ============================================================================

-- To verify the migration, run these queries:
--
-- Check columns exist:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema='dw' AND table_name='dim_product_cluster';
--
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema='dw' AND table_name='dim_cluster';
--
-- Check existing records got default value:
-- SELECT COUNT(*) FROM dw.dim_product_cluster WHERE unit_multiplier = 1;
--
-- Test the RPCs:
-- SELECT * FROM get_clusters_by_type('product');
-- SELECT * FROM get_cluster_members(1, 'product');  -- replace with actual cluster_id
