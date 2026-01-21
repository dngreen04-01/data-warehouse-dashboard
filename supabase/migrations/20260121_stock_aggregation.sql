-- =============================================================================
-- Migration: 20260121_stock_aggregation.sql
-- Purpose: Create comprehensive stock aggregation RPC for cluster analytics
--          Shows our stock + supplier finished stock + supplier WIP stock +
--          production capacity for each product cluster.
-- Reference: docs/ExecPlan-WIPUnpackedProducts.md - Milestone 5
-- =============================================================================

-- -----------------------------------------------------------------------------
-- get_cluster_stock_totals() RPC
-- Returns comprehensive stock totals for each product cluster
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_cluster_stock_totals()
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    base_unit_label text,
    -- Our stock
    our_units_on_hand numeric,
    -- Supplier finished stock (all suppliers combined)
    supplier_finished_units numeric,
    -- Supplier WIP stock
    supplier_wip_units numeric,
    -- Total available now
    total_available_units numeric,
    -- Production capacity
    production_capacity_per_day numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH cluster_data AS (
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.base_unit_label
        FROM dw.dim_cluster c
        WHERE c.cluster_type = 'product'
    ),
    our_stock AS (
        -- Our inventory (finished products only)
        SELECT
            pc.cluster_id,
            SUM(COALESCE(p.quantity_on_hand, 0) * pc.unit_multiplier) as units
        FROM dw.dim_product_cluster pc
        JOIN dw.dim_product p ON p.product_id = pc.product_id
        WHERE (p.product_type IS NULL OR p.product_type = 'finished')
          AND p.archived = false
        GROUP BY pc.cluster_id
    ),
    supplier_finished AS (
        -- Supplier stock of finished products (current week)
        SELECT
            pc.cluster_id,
            SUM(COALESCE(sse.quantity_on_hand, 0) * pc.unit_multiplier) as units
        FROM dw.supplier_stock_entry sse
        JOIN dw.dim_product p ON p.product_id = sse.product_id
        JOIN dw.dim_product_cluster pc ON pc.product_id = p.product_id
        WHERE (p.product_type IS NULL OR p.product_type = 'finished')
          AND sse.week_ending = dw.get_week_ending(CURRENT_DATE)
        GROUP BY pc.cluster_id
    ),
    supplier_wip AS (
        -- Supplier WIP stock (current week)
        -- WIP products are measured in base units directly (no multiplier needed)
        SELECT
            p.wip_for_cluster_id as cluster_id,
            SUM(COALESCE(sse.quantity_on_hand, 0)) as units
        FROM dw.supplier_stock_entry sse
        JOIN dw.dim_product p ON p.product_id = sse.product_id
        WHERE p.product_type = 'wip'
          AND sse.week_ending = dw.get_week_ending(CURRENT_DATE)
        GROUP BY p.wip_for_cluster_id
    ),
    production_capacity AS (
        -- Production capacity from WIP products
        SELECT
            p.wip_for_cluster_id as cluster_id,
            SUM(COALESCE(p.production_capacity_per_day, 0)) as capacity
        FROM dw.dim_product p
        WHERE p.product_type = 'wip'
          AND p.archived = false
        GROUP BY p.wip_for_cluster_id
    )
    SELECT
        cd.cluster_id,
        cd.cluster_label,
        cd.base_unit_label,
        COALESCE(os.units, 0) as our_units_on_hand,
        COALESCE(sf.units, 0) as supplier_finished_units,
        COALESCE(sw.units, 0) as supplier_wip_units,
        COALESCE(os.units, 0) + COALESCE(sf.units, 0) + COALESCE(sw.units, 0) as total_available_units,
        COALESCE(pc.capacity, 0) as production_capacity_per_day
    FROM cluster_data cd
    LEFT JOIN our_stock os ON os.cluster_id = cd.cluster_id
    LEFT JOIN supplier_finished sf ON sf.cluster_id = cd.cluster_id
    LEFT JOIN supplier_wip sw ON sw.cluster_id = cd.cluster_id
    LEFT JOIN production_capacity pc ON pc.cluster_id = cd.cluster_id
    ORDER BY cd.cluster_label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cluster_stock_totals() TO authenticated;

COMMENT ON FUNCTION public.get_cluster_stock_totals() IS
'Returns comprehensive stock totals for each product cluster including:
- Our stock (from dim_product.quantity_on_hand)
- Supplier finished stock (from supplier_stock_entry for finished products)
- Supplier WIP stock (from supplier_stock_entry for WIP products)
- Total available (sum of all three)
- Production capacity (from WIP products, units per day)
Note: Demand-based calculations are out of scope. Production capacity is stored for future demand planning features.';


-- -----------------------------------------------------------------------------
-- Verification Query
-- -----------------------------------------------------------------------------
-- To verify the migration, run:
-- SELECT * FROM get_cluster_stock_totals();
