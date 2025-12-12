-- Cluster Separation & Management Enhancement
-- Date: 2025-12-12
-- Purpose: Separate customer/product clusters, enforce one-per-entity, add edit RPCs
-- NOTE: Preserves existing clusters from historical load and marks them as customer clusters

-- ============================================================================
-- PHASE 1: Schema Changes
-- ============================================================================

-- 1.1 Add cluster_type to dim_cluster to separate customer vs product clusters
ALTER TABLE dw.dim_cluster ADD COLUMN IF NOT EXISTS cluster_type text;

-- 1.1b Add updated_at column for tracking changes (required by rename_cluster RPC)
ALTER TABLE dw.dim_cluster ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT timezone('utc', now());

-- Add check constraint for valid types
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'dim_cluster_type_check'
    ) THEN
        ALTER TABLE dw.dim_cluster ADD CONSTRAINT dim_cluster_type_check
            CHECK (cluster_type IN ('customer', 'product'));
    END IF;
END$$;

-- 1.2 Mark ALL existing clusters as 'customer' type (they came from customer_clusters.csv)
UPDATE dw.dim_cluster
SET cluster_type = 'customer'
WHERE cluster_type IS NULL;

-- 1.3 Add auto-increment sequence to cluster_id
CREATE SEQUENCE IF NOT EXISTS dw.dim_cluster_id_seq;

-- Set sequence to current max value (so new clusters get IDs after existing ones)
SELECT setval('dw.dim_cluster_id_seq', COALESCE((SELECT MAX(cluster_id) FROM dw.dim_cluster), 0) + 1, false);

-- Set default for cluster_id
ALTER TABLE dw.dim_cluster ALTER COLUMN cluster_id SET DEFAULT nextval('dw.dim_cluster_id_seq');

-- 1.4 Handle one cluster per customer
-- For customers with multiple cluster assignments, keep only one (the highest cluster_id)
-- This preserves the most data while enforcing the one-per-entity rule
DO $$
BEGIN
    -- Only delete duplicates if the table has the composite PK
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'dw'
        AND table_name = 'dim_customer_cluster'
        AND constraint_type = 'PRIMARY KEY'
        AND constraint_name = 'dim_customer_cluster_pkey'
    ) THEN
        DELETE FROM dw.dim_customer_cluster cc1
        WHERE EXISTS (
            SELECT 1 FROM dw.dim_customer_cluster cc2
            WHERE cc1.customer_id = cc2.customer_id
            AND cc1.cluster_id < cc2.cluster_id
        );

        -- Drop the existing composite primary key and add single-column PK
        ALTER TABLE dw.dim_customer_cluster DROP CONSTRAINT dim_customer_cluster_pkey;
        ALTER TABLE dw.dim_customer_cluster ADD PRIMARY KEY (customer_id);
    END IF;
END$$;

-- Keep cluster_id as a regular column with FK reference (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'dim_customer_cluster_cluster_id_fkey'
    ) THEN
        ALTER TABLE dw.dim_customer_cluster ADD CONSTRAINT dim_customer_cluster_cluster_id_fkey
            FOREIGN KEY (cluster_id) REFERENCES dw.dim_cluster(cluster_id) ON DELETE CASCADE;
    END IF;
END$$;

-- 1.5 Handle one cluster per product (dim_product_cluster may not exist yet or be empty)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'dw' AND table_name = 'dim_product_cluster'
    ) THEN
        -- Delete duplicates if any exist
        DELETE FROM dw.dim_product_cluster pc1
        WHERE EXISTS (
            SELECT 1 FROM dw.dim_product_cluster pc2
            WHERE pc1.product_id = pc2.product_id
            AND pc1.cluster_id < pc2.cluster_id
        );

        -- Check if we need to change the PK
        IF EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'dw'
            AND table_name = 'dim_product_cluster'
            AND constraint_type = 'PRIMARY KEY'
            AND constraint_name = 'dim_product_cluster_pkey'
        ) THEN
            -- Check if the current PK includes cluster_id (composite)
            IF EXISTS (
                SELECT 1 FROM information_schema.key_column_usage
                WHERE table_schema = 'dw'
                AND table_name = 'dim_product_cluster'
                AND constraint_name = 'dim_product_cluster_pkey'
                AND column_name = 'cluster_id'
            ) THEN
                ALTER TABLE dw.dim_product_cluster DROP CONSTRAINT dim_product_cluster_pkey;
                ALTER TABLE dw.dim_product_cluster ADD PRIMARY KEY (product_id);
            END IF;
        END IF;

        -- Add FK if not exists
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'dim_product_cluster_cluster_id_fkey'
        ) THEN
            ALTER TABLE dw.dim_product_cluster ADD CONSTRAINT dim_product_cluster_cluster_id_fkey
                FOREIGN KEY (cluster_id) REFERENCES dw.dim_cluster(cluster_id) ON DELETE CASCADE;
        END IF;
    END IF;
END$$;

-- ============================================================================
-- PHASE 2: Updated RPCs
-- ============================================================================

-- 2.1 Create cluster with type parameter
DROP FUNCTION IF EXISTS public.create_cluster(text);
CREATE OR REPLACE FUNCTION public.create_cluster(
    p_label text,
    p_type text DEFAULT 'customer'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id int;
BEGIN
    INSERT INTO dw.dim_cluster (cluster_label, cluster_type)
    VALUES (p_label, p_type)
    RETURNING cluster_id INTO v_id;
    RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_cluster(text, text) TO authenticated;

-- 2.2 Get clusters filtered by type
CREATE OR REPLACE FUNCTION public.get_clusters_by_type(
    p_type text
)
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    cluster_type text,
    member_count bigint
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
            COUNT(cc.customer_id)::bigint as member_count
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_customer_cluster cc ON cc.cluster_id = c.cluster_id
        WHERE c.cluster_type = 'customer' OR c.cluster_type IS NULL
        GROUP BY c.cluster_id, c.cluster_label, c.cluster_type
        ORDER BY c.cluster_label;
    ELSE
        RETURN QUERY
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.cluster_type,
            COUNT(pc.product_id)::bigint as member_count
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_product_cluster pc ON pc.cluster_id = c.cluster_id
        WHERE c.cluster_type = 'product'
        GROUP BY c.cluster_id, c.cluster_label, c.cluster_type
        ORDER BY c.cluster_label;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_clusters_by_type(text) TO authenticated;

-- 2.3 Update manage_cluster_member to handle one-per-entity (upsert instead of insert)
DROP FUNCTION IF EXISTS public.manage_cluster_member(text, text, int, text);
CREATE OR REPLACE FUNCTION public.manage_cluster_member(
    p_type text,
    p_action text,
    p_cluster_id int,
    p_entity_id text
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
            -- Upsert: insert or update if already assigned to a different cluster
            INSERT INTO dw.dim_product_cluster (product_id, cluster_id)
            VALUES (p_entity_id::bigint, p_cluster_id)
            ON CONFLICT (product_id) DO UPDATE SET cluster_id = p_cluster_id;
        ELSE
            DELETE FROM dw.dim_product_cluster
            WHERE product_id = p_entity_id::bigint AND cluster_id = p_cluster_id;
        END IF;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.manage_cluster_member(text, text, int, text) TO authenticated;

-- 2.4 Get cluster members (fix product_id type casting)
DROP FUNCTION IF EXISTS public.get_cluster_members(int, text);
CREATE OR REPLACE FUNCTION public.get_cluster_members(
    p_cluster_id int,
    p_type text
)
RETURNS TABLE (
    id text,
    name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF p_type = 'customer' THEN
        RETURN QUERY
        SELECT c.customer_id::text, c.customer_name::text
        FROM dw.dim_customer_cluster cc
        JOIN dw.dim_customer c ON c.customer_id = cc.customer_id
        WHERE cc.cluster_id = p_cluster_id
        ORDER BY c.customer_name;
    ELSE
        RETURN QUERY
        SELECT p.product_id::text, p.item_name::text
        FROM dw.dim_product_cluster pc
        JOIN dw.dim_product p ON p.product_id = pc.product_id
        WHERE pc.cluster_id = p_cluster_id
        ORDER BY p.item_name;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_cluster_members(int, text) TO authenticated;

-- ============================================================================
-- PHASE 3: Customer & Product Update RPCs
-- ============================================================================

-- 3.1 Update customer details
CREATE OR REPLACE FUNCTION public.update_customer(
    p_customer_id text,
    p_customer_name text DEFAULT NULL,
    p_market text DEFAULT NULL,
    p_merchant_group text DEFAULT NULL,
    p_customer_type text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE dw.dim_customer
    SET
        customer_name = COALESCE(p_customer_name, customer_name),
        market = COALESCE(p_market, market),
        merchant_group = COALESCE(p_merchant_group, merchant_group),
        customer_type = COALESCE(p_customer_type, customer_type),
        updated_at = timezone('utc', now())
    WHERE customer_id = p_customer_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_customer(text, text, text, text, text) TO authenticated;

-- 3.2 Update product details
CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE dw.dim_product
    SET
        product_group = COALESCE(p_product_group, product_group),
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_product(bigint, text) TO authenticated;

-- ============================================================================
-- PHASE 4: Fetch with Cluster Info RPCs
-- ============================================================================

-- 4.1 Get customers with their cluster assignment
CREATE OR REPLACE FUNCTION public.get_customers_with_clusters()
RETURNS TABLE (
    customer_id text,
    customer_name text,
    contact_name text,
    bill_to text,
    market text,
    merchant_group text,
    customer_type text,
    balance_total numeric,
    archived boolean,
    cluster_id int,
    cluster_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.customer_id,
        c.customer_name,
        c.contact_name,
        c.bill_to,
        c.market,
        c.merchant_group,
        c.customer_type,
        c.balance_total,
        c.archived,
        cl.cluster_id,
        cl.cluster_label
    FROM dw.dim_customer c
    LEFT JOIN dw.dim_customer_cluster cc ON cc.customer_id = c.customer_id
    LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = cc.cluster_id
    WHERE c.archived = false
    ORDER BY c.customer_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_customers_with_clusters() TO authenticated;

-- 4.2 Get products with their cluster assignment
CREATE OR REPLACE FUNCTION public.get_products_with_clusters()
RETURNS TABLE (
    product_id bigint,
    product_code text,
    item_name text,
    item_description text,
    product_group text,
    price numeric,
    archived boolean,
    cluster_id int,
    cluster_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.product_id,
        p.product_code,
        p.item_name,
        p.item_description,
        p.product_group,
        p.price,
        p.archived,
        cl.cluster_id,
        cl.cluster_label
    FROM dw.dim_product p
    LEFT JOIN dw.dim_product_cluster pc ON pc.product_id = p.product_id
    LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = pc.cluster_id
    WHERE p.archived = false
    ORDER BY p.item_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_products_with_clusters() TO authenticated;

-- ============================================================================
-- PHASE 5: Additional Helper Functions
-- ============================================================================

-- 5.1 Get available markets (for dropdown)
CREATE OR REPLACE FUNCTION public.get_distinct_markets()
RETURNS TABLE (market text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT c.market
    FROM dw.dim_customer c
    WHERE c.market IS NOT NULL AND c.market != ''
    ORDER BY c.market;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_distinct_markets() TO authenticated;

-- 5.2 Get available merchant groups (for dropdown)
CREATE OR REPLACE FUNCTION public.get_distinct_merchant_groups()
RETURNS TABLE (merchant_group text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT c.merchant_group
    FROM dw.dim_customer c
    WHERE c.merchant_group IS NOT NULL AND c.merchant_group != ''
    ORDER BY c.merchant_group;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_distinct_merchant_groups() TO authenticated;

-- 5.3 Get available product groups (for dropdown)
CREATE OR REPLACE FUNCTION public.get_distinct_product_groups()
RETURNS TABLE (product_group text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT p.product_group
    FROM dw.dim_product p
    WHERE p.product_group IS NOT NULL AND p.product_group != ''
    ORDER BY p.product_group;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_distinct_product_groups() TO authenticated;
