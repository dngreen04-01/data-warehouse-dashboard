-- Cluster Analytics RPCs for Production Planning
-- Date: 2026-01-19
-- Purpose: Create aggregation functions that apply unit multipliers for cluster analytics
-- Reference: docs/ExecPlan-ProductClusterUnitMultipliers.md - Milestone 2

-- ============================================================================
-- PHASE 1: get_product_cluster_summary()
-- Returns aggregated stats for each product cluster
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_product_cluster_summary()
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    base_unit_label text,
    product_count bigint,
    total_units_on_hand numeric,
    total_units_sold_30d numeric,
    total_units_sold_90d numeric,
    total_revenue_30d numeric,
    total_revenue_90d numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today date := CURRENT_DATE;
    v_30d_ago date := CURRENT_DATE - INTERVAL '30 days';
    v_90d_ago date := CURRENT_DATE - INTERVAL '90 days';
BEGIN
    RETURN QUERY
    WITH cluster_products AS (
        -- Get all products in each cluster with their multipliers
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.base_unit_label,
            pc.product_id,
            pc.unit_multiplier,
            p.quantity_on_hand
        FROM dw.dim_cluster c
        LEFT JOIN dw.dim_product_cluster pc ON pc.cluster_id = c.cluster_id
        LEFT JOIN dw.dim_product p ON p.product_id = pc.product_id
        WHERE c.cluster_type = 'product'
    ),
    sales_30d AS (
        -- Sales in last 30 days
        SELECT
            cp.cluster_id,
            SUM(sl.qty * cp.unit_multiplier) as units_sold,
            SUM(sl.line_amount) as revenue
        FROM cluster_products cp
        JOIN dw.fct_sales_line sl ON sl.product_id = cp.product_id
        WHERE sl.invoice_date >= v_30d_ago
          AND sl.invoice_date <= v_today
        GROUP BY cp.cluster_id
    ),
    sales_90d AS (
        -- Sales in last 90 days
        SELECT
            cp.cluster_id,
            SUM(sl.qty * cp.unit_multiplier) as units_sold,
            SUM(sl.line_amount) as revenue
        FROM cluster_products cp
        JOIN dw.fct_sales_line sl ON sl.product_id = cp.product_id
        WHERE sl.invoice_date >= v_90d_ago
          AND sl.invoice_date <= v_today
        GROUP BY cp.cluster_id
    ),
    inventory AS (
        -- Current inventory aggregated
        SELECT
            cp.cluster_id,
            SUM(COALESCE(cp.quantity_on_hand, 0) * cp.unit_multiplier) as units_on_hand
        FROM cluster_products cp
        WHERE cp.product_id IS NOT NULL
        GROUP BY cp.cluster_id
    ),
    product_counts AS (
        -- Count products per cluster
        SELECT
            cp.cluster_id,
            COUNT(DISTINCT cp.product_id) as product_count
        FROM cluster_products cp
        WHERE cp.product_id IS NOT NULL
        GROUP BY cp.cluster_id
    )
    SELECT
        c.cluster_id,
        c.cluster_label,
        c.base_unit_label,
        COALESCE(cnt.product_count, 0)::bigint as product_count,
        COALESCE(inv.units_on_hand, 0) as total_units_on_hand,
        COALESCE(s30.units_sold, 0) as total_units_sold_30d,
        COALESCE(s90.units_sold, 0) as total_units_sold_90d,
        COALESCE(s30.revenue, 0) as total_revenue_30d,
        COALESCE(s90.revenue, 0) as total_revenue_90d
    FROM dw.dim_cluster c
    LEFT JOIN product_counts cnt ON cnt.cluster_id = c.cluster_id
    LEFT JOIN inventory inv ON inv.cluster_id = c.cluster_id
    LEFT JOIN sales_30d s30 ON s30.cluster_id = c.cluster_id
    LEFT JOIN sales_90d s90 ON s90.cluster_id = c.cluster_id
    WHERE c.cluster_type = 'product'
    ORDER BY c.cluster_label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_cluster_summary() TO authenticated;

COMMENT ON FUNCTION public.get_product_cluster_summary() IS
'Returns aggregated analytics for all product clusters with unit multipliers applied.
Includes: product count, total base units on hand, units sold (30d/90d), revenue (30d/90d).';


-- ============================================================================
-- PHASE 2: get_cluster_product_details(p_cluster_id)
-- Returns products within a cluster with their unit calculations
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cluster_product_details(
    p_cluster_id int
)
RETURNS TABLE (
    product_id bigint,
    product_code text,
    item_name text,
    unit_multiplier numeric,
    quantity_on_hand numeric,
    units_on_hand numeric,
    qty_sold_30d numeric,
    units_sold_30d numeric,
    revenue_30d numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_today date := CURRENT_DATE;
    v_30d_ago date := CURRENT_DATE - INTERVAL '30 days';
BEGIN
    RETURN QUERY
    WITH product_sales AS (
        -- Aggregate sales per product for last 30 days
        SELECT
            sl.product_id,
            SUM(sl.qty) as qty_sold,
            SUM(sl.line_amount) as revenue
        FROM dw.fct_sales_line sl
        WHERE sl.invoice_date >= v_30d_ago
          AND sl.invoice_date <= v_today
        GROUP BY sl.product_id
    )
    SELECT
        p.product_id,
        p.product_code,
        p.item_name,
        pc.unit_multiplier,
        COALESCE(p.quantity_on_hand, 0) as quantity_on_hand,
        COALESCE(p.quantity_on_hand, 0) * pc.unit_multiplier as units_on_hand,
        COALESCE(ps.qty_sold, 0) as qty_sold_30d,
        COALESCE(ps.qty_sold, 0) * pc.unit_multiplier as units_sold_30d,
        COALESCE(ps.revenue, 0) as revenue_30d
    FROM dw.dim_product_cluster pc
    JOIN dw.dim_product p ON p.product_id = pc.product_id
    LEFT JOIN product_sales ps ON ps.product_id = p.product_id
    WHERE pc.cluster_id = p_cluster_id
    ORDER BY p.item_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cluster_product_details(int) TO authenticated;

COMMENT ON FUNCTION public.get_cluster_product_details(int) IS
'Returns detailed product information within a cluster including unit multiplier calculations.
Shows raw quantities and multiplied base units for inventory and sales.';


-- ============================================================================
-- PHASE 3: get_cluster_sales_timeseries(p_cluster_id, p_start_date, p_end_date)
-- Returns daily sales aggregation for a cluster
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_cluster_sales_timeseries(
    p_cluster_id int,
    p_start_date date,
    p_end_date date
)
RETURNS TABLE (
    period_date date,
    total_units_sold numeric,
    total_revenue numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Validate date range
    IF p_end_date < p_start_date THEN
        RAISE EXCEPTION 'End date must be after start date';
    END IF;

    RETURN QUERY
    WITH date_series AS (
        -- Generate continuous date range to ensure all days are included
        SELECT generate_series(p_start_date, p_end_date, '1 day'::interval)::date as period_date
    ),
    cluster_products AS (
        -- Get products in this cluster
        SELECT
            pc.product_id,
            pc.unit_multiplier
        FROM dw.dim_product_cluster pc
        WHERE pc.cluster_id = p_cluster_id
    ),
    daily_sales AS (
        -- Aggregate sales per day
        SELECT
            sl.invoice_date,
            SUM(sl.qty * cp.unit_multiplier) as units_sold,
            SUM(sl.line_amount) as revenue
        FROM cluster_products cp
        JOIN dw.fct_sales_line sl ON sl.product_id = cp.product_id
        WHERE sl.invoice_date >= p_start_date
          AND sl.invoice_date <= p_end_date
        GROUP BY sl.invoice_date
    )
    SELECT
        ds.period_date,
        COALESCE(s.units_sold, 0) as total_units_sold,
        COALESCE(s.revenue, 0) as total_revenue
    FROM date_series ds
    LEFT JOIN daily_sales s ON s.invoice_date = ds.period_date
    ORDER BY ds.period_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cluster_sales_timeseries(int, date, date) TO authenticated;

COMMENT ON FUNCTION public.get_cluster_sales_timeseries(int, date, date) IS
'Returns daily sales time series for a product cluster with unit multipliers applied.
Includes all days in range even if no sales (returns 0).';


-- ============================================================================
-- PHASE 4: mart.cluster_units_summary view
-- Summary view for dashboard widgets
-- ============================================================================

CREATE OR REPLACE VIEW mart.cluster_units_summary AS
WITH cluster_products AS (
    SELECT
        c.cluster_id,
        c.cluster_label,
        c.base_unit_label,
        pc.product_id,
        pc.unit_multiplier,
        p.quantity_on_hand
    FROM dw.dim_cluster c
    LEFT JOIN dw.dim_product_cluster pc ON pc.cluster_id = c.cluster_id
    LEFT JOIN dw.dim_product p ON p.product_id = pc.product_id
    WHERE c.cluster_type = 'product'
),
sales_30d AS (
    SELECT
        cp.cluster_id,
        SUM(sl.qty * cp.unit_multiplier) as units_sold,
        SUM(sl.line_amount) as revenue
    FROM cluster_products cp
    JOIN dw.fct_sales_line sl ON sl.product_id = cp.product_id
    WHERE sl.invoice_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY cp.cluster_id
),
inventory AS (
    SELECT
        cp.cluster_id,
        SUM(COALESCE(cp.quantity_on_hand, 0) * cp.unit_multiplier) as units_on_hand
    FROM cluster_products cp
    WHERE cp.product_id IS NOT NULL
    GROUP BY cp.cluster_id
),
product_counts AS (
    SELECT
        cp.cluster_id,
        COUNT(DISTINCT cp.product_id) as product_count
    FROM cluster_products cp
    WHERE cp.product_id IS NOT NULL
    GROUP BY cp.cluster_id
)
SELECT
    c.cluster_id,
    c.cluster_label,
    c.base_unit_label,
    COALESCE(cnt.product_count, 0)::int as product_count,
    COALESCE(inv.units_on_hand, 0) as total_units_on_hand,
    COALESCE(s30.units_sold, 0) as total_units_sold_30d,
    COALESCE(s30.revenue, 0) as total_revenue_30d,
    -- Calculate estimated days of stock based on 30d sales rate
    CASE
        WHEN COALESCE(s30.units_sold, 0) > 0 THEN
            ROUND((COALESCE(inv.units_on_hand, 0) / (s30.units_sold / 30))::numeric, 1)
        ELSE NULL
    END as estimated_days_of_stock
FROM dw.dim_cluster c
LEFT JOIN product_counts cnt ON cnt.cluster_id = c.cluster_id
LEFT JOIN inventory inv ON inv.cluster_id = c.cluster_id
LEFT JOIN sales_30d s30 ON s30.cluster_id = c.cluster_id
WHERE c.cluster_type = 'product';

COMMENT ON VIEW mart.cluster_units_summary IS
'Summary view for product clusters with unit multiplier calculations.
Includes units on hand, units sold (30d), revenue, and estimated days of stock.';


-- ============================================================================
-- PHASE 5: Verification Queries (for manual testing)
-- ============================================================================

-- To verify the migration, run these queries:
--
-- Test get_product_cluster_summary:
-- SELECT * FROM get_product_cluster_summary();
--
-- Test get_cluster_product_details (replace 1 with actual cluster_id):
-- SELECT * FROM get_cluster_product_details(1);
--
-- Test get_cluster_sales_timeseries:
-- SELECT * FROM get_cluster_sales_timeseries(1, CURRENT_DATE - 30, CURRENT_DATE);
--
-- Test the summary view:
-- SELECT * FROM mart.cluster_units_summary;
