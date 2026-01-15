-- Product Sales Calendar RPC Function
-- Date: 2026-01-15
-- Purpose: Monthly sales aggregation for calendar view with dimension support

-- ============================================================================
-- Drop existing function if exists
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_product_sales_calendar(date, date, text[], text[], text[], text[], text[]);
DROP FUNCTION IF EXISTS public.get_product_sales_calendar(text, date, date, text[], text[], text[], text[], text[]);

-- ============================================================================
-- Create get_product_sales_calendar function with dimension parameter
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_product_sales_calendar(
    p_dimension text DEFAULT 'product',
    p_start_date date DEFAULT NULL,
    p_end_date date DEFAULT NULL,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,
    p_market text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL,
    p_product_cluster text[] DEFAULT NULL
)
RETURNS TABLE (
    label text,
    month_date date,
    revenue numeric,
    quantity numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Handle product_cluster dimension specially
    IF p_dimension = 'product_cluster' THEN
        RETURN QUERY
        SELECT
            COALESCE(cl.cluster_label, 'Unclustered')::text AS label,
            DATE_TRUNC('month', s.invoice_date)::date AS month_date,
            SUM(s.line_amount) AS revenue,
            SUM(s.qty) AS quantity
        FROM mart.sales_enriched s
        LEFT JOIN dw.dim_product_cluster pc ON pc.product_id = s.product_id
        LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = pc.cluster_id AND cl.cluster_type = 'product'
        -- Also join for product cluster filter (different from dimension)
        LEFT JOIN dw.dim_product_cluster dpc_filter ON dpc_filter.product_id = s.product_id
        LEFT JOIN dw.dim_cluster pc_filter ON pc_filter.cluster_id = dpc_filter.cluster_id AND pc_filter.cluster_type = 'product'
        WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
          AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
          AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
          AND (p_market IS NULL OR s.market = ANY(p_market))
          AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
          AND (p_product_cluster IS NULL OR pc_filter.cluster_label = ANY(p_product_cluster))
          AND (s.product_group IS NULL OR s.product_group NOT IN (
              SELECT e.product_group FROM dw.dim_product_group_exclusions e
          ))
        GROUP BY cl.cluster_label, DATE_TRUNC('month', s.invoice_date)::date
        ORDER BY label, month_date;
    ELSE
        -- For other dimensions, use CTE approach
        RETURN QUERY
        WITH filtered_sales AS (
            SELECT
                s.*
            FROM mart.sales_enriched s
            LEFT JOIN dw.dim_product_cluster dpc ON dpc.product_id = s.product_id
            LEFT JOIN dw.dim_cluster pc_cl ON pc_cl.cluster_id = dpc.cluster_id AND pc_cl.cluster_type = 'product'
            WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
              AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
              AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
              AND (p_market IS NULL OR s.market = ANY(p_market))
              AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
              AND (p_product_cluster IS NULL OR pc_cl.cluster_label = ANY(p_product_cluster))
              AND (s.product_group IS NULL OR s.product_group NOT IN (
                  SELECT e.product_group FROM dw.dim_product_group_exclusions e
              ))
        )
        SELECT
            COALESCE(
                CASE
                    WHEN p_dimension = 'product' THEN fs.item_name
                    WHEN p_dimension = 'customer' THEN fs.customer_name
                    WHEN p_dimension = 'market' THEN fs.market
                    WHEN p_dimension = 'merchant_group' THEN fs.merchant_group
                    WHEN p_dimension = 'customer_cluster' THEN fs.cluster_label
                    ELSE fs.item_name
                END,
                'Unknown'
            )::text AS label,
            DATE_TRUNC('month', fs.invoice_date)::date AS month_date,
            SUM(fs.line_amount) AS revenue,
            SUM(fs.qty) AS quantity
        FROM filtered_sales fs
        GROUP BY 1, DATE_TRUNC('month', fs.invoice_date)::date
        ORDER BY label, month_date;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_product_sales_calendar TO authenticated;
