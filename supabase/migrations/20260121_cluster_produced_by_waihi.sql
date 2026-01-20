-- Add "Produced by Waihi" flag to product clusters
-- Date: 2026-01-21
-- Purpose: Flag controls visibility on /supplier/stock page - only Waihi-produced clusters appear

-- ============================================================================
-- PHASE 1: Schema Changes
-- ============================================================================

-- 1.1 Add produced_by_waihi column to dim_cluster
-- Default false means new clusters won't appear on supplier page until enabled
ALTER TABLE dw.dim_cluster
ADD COLUMN IF NOT EXISTS produced_by_waihi boolean NOT NULL DEFAULT false;

-- ============================================================================
-- PHASE 2: Update get_clusters_by_type RPC
-- ============================================================================

-- Add produced_by_waihi to the return type
DROP FUNCTION IF EXISTS public.get_clusters_by_type(text);
CREATE OR REPLACE FUNCTION public.get_clusters_by_type(
    p_type text
)
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    cluster_type text,
    member_count bigint,
    base_unit_label text,
    produced_by_waihi boolean
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
            c.base_unit_label,
            c.produced_by_waihi
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_customer_cluster cc ON cc.cluster_id = c.cluster_id
        WHERE c.cluster_type = 'customer' OR c.cluster_type IS NULL
        GROUP BY c.cluster_id, c.cluster_label, c.cluster_type, c.base_unit_label, c.produced_by_waihi
        ORDER BY c.cluster_label;
    ELSE
        RETURN QUERY
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.cluster_type,
            COUNT(pc.product_id)::bigint as member_count,
            c.base_unit_label,
            c.produced_by_waihi
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_product_cluster pc ON pc.cluster_id = c.cluster_id
        WHERE c.cluster_type = 'product'
        GROUP BY c.cluster_id, c.cluster_label, c.cluster_type, c.base_unit_label, c.produced_by_waihi
        ORDER BY c.cluster_label;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_clusters_by_type(text) TO authenticated;

-- ============================================================================
-- PHASE 3: New RPC to update produced_by_waihi flag
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_cluster_produced_by_waihi(
    p_cluster_id int,
    p_produced_by_waihi boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE dw.dim_cluster
    SET produced_by_waihi = p_produced_by_waihi,
        updated_at = timezone('utc', now())
    WHERE cluster_id = p_cluster_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cluster % not found', p_cluster_id;
    END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_cluster_produced_by_waihi(int, boolean) TO authenticated;

-- ============================================================================
-- VERIFICATION QUERIES (run manually after migration)
-- ============================================================================

-- Check column exists:
-- SELECT column_name, data_type, column_default
-- FROM information_schema.columns
-- WHERE table_schema='dw' AND table_name='dim_cluster' AND column_name='produced_by_waihi';

-- Check RPC returns new column:
-- SELECT * FROM get_clusters_by_type('product');

-- Test update RPC:
-- SELECT update_cluster_produced_by_waihi(1, true);  -- replace 1 with actual cluster_id
