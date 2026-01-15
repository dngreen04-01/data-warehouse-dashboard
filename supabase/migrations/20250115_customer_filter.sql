-- Customer Filter Support for Dashboard
-- Date: 2025-01-15
-- Purpose: Add customer filter to dashboard - only customers with market or merchant_group

-- ============================================================================
-- 1. Update get_filter_options to include customers
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_filter_options();

CREATE OR REPLACE FUNCTION public.get_filter_options()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_result json;
BEGIN
    SELECT json_build_object(
        'markets', (SELECT ARRAY_AGG(DISTINCT market) FROM dw.dim_customer WHERE market IS NOT NULL),
        -- Return actual product names (item_name) that have sales
        'product_groups', (
            SELECT ARRAY_AGG(item_name ORDER BY item_name)
            FROM (
                SELECT DISTINCT p.item_name
                FROM dw.dim_product p
                INNER JOIN dw.fct_sales_line sl ON sl.product_id = p.product_id
                WHERE p.item_name IS NOT NULL
                  AND p.item_name != ''
                  AND (p.product_group IS NULL OR p.product_group NOT IN (
                      SELECT e.product_group FROM dw.dim_product_group_exclusions e
                  ))
            ) AS filtered_products
        ),
        'merchant_groups', (SELECT ARRAY_AGG(DISTINCT merchant_group) FROM dw.dim_customer WHERE merchant_group IS NOT NULL),
        -- Customers: only those with a market or merchant_group
        'customers', (
            SELECT ARRAY_AGG(name ORDER BY name)
            FROM dw.dim_customer
            WHERE name IS NOT NULL
              AND name != ''
              AND (market IS NOT NULL OR merchant_group IS NOT NULL)
        ),
        -- Customer clusters (for backwards compatibility, also include as 'clusters')
        'clusters', (SELECT ARRAY_AGG(DISTINCT cluster_label) FROM dw.dim_cluster WHERE cluster_type = 'customer' OR cluster_type IS NULL),
        'customer_clusters', (SELECT ARRAY_AGG(DISTINCT cluster_label) FROM dw.dim_cluster WHERE cluster_type = 'customer' OR cluster_type IS NULL),
        -- Product clusters
        'product_clusters', (SELECT ARRAY_AGG(DISTINCT cluster_label) FROM dw.dim_cluster WHERE cluster_type = 'product')
    ) INTO v_result;
    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_filter_options TO authenticated;

-- ============================================================================
-- 2. Update get_sales_overview to support customer filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_sales_overview(date, date, text[], text[], text[], text[], text[]);

CREATE OR REPLACE FUNCTION public.get_sales_overview(
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,
    p_market text[] DEFAULT NULL,
    p_customer text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL,
    p_product_cluster text[] DEFAULT NULL
)
RETURNS TABLE (
    invoice_date date,
    revenue numeric,
    quantity numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.invoice_date,
        SUM(s.line_amount) AS revenue,
        SUM(s.qty) AS quantity
    FROM mart.sales_enriched s
    -- Join for product cluster filtering
    LEFT JOIN dw.dim_product_cluster dpc ON dpc.product_id = s.product_id
    LEFT JOIN dw.dim_cluster pc_cl ON pc_cl.cluster_id = dpc.cluster_id AND pc_cl.cluster_type = 'product'
    WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
      AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
      AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
      AND (p_market IS NULL OR s.market = ANY(p_market))
      AND (p_customer IS NULL OR s.customer_name = ANY(p_customer))
      AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
      -- Product cluster filter
      AND (p_product_cluster IS NULL OR pc_cl.cluster_label = ANY(p_product_cluster))
      -- Exclude non-revenue product groups
      AND (s.product_group IS NULL OR s.product_group NOT IN (
          SELECT e.product_group FROM dw.dim_product_group_exclusions e
      ))
    GROUP BY s.invoice_date
    ORDER BY s.invoice_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_overview TO authenticated;

-- ============================================================================
-- 3. Update get_yoy_comparison to support customer filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_yoy_comparison(date, date, text[], text[], text[], text[], text[]);

CREATE OR REPLACE FUNCTION public.get_yoy_comparison(
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,
    p_market text[] DEFAULT NULL,
    p_customer text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL,
    p_product_cluster text[] DEFAULT NULL
)
RETURNS TABLE (
    period text,
    current_revenue numeric,
    previous_revenue numeric,
    current_qty numeric,
    previous_qty numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_prev_start date := p_start_date - INTERVAL '1 year';
    v_prev_end date := p_end_date - INTERVAL '1 year';
    v_curr_rev numeric;
    v_curr_qty numeric;
    v_prev_rev numeric;
    v_prev_qty numeric;
BEGIN
    -- Current Period
    SELECT
        COALESCE(SUM(s.line_amount), 0),
        COALESCE(SUM(s.qty), 0)
    INTO v_curr_rev, v_curr_qty
    FROM mart.sales_enriched s
    LEFT JOIN dw.dim_product_cluster dpc ON dpc.product_id = s.product_id
    LEFT JOIN dw.dim_cluster pc_cl ON pc_cl.cluster_id = dpc.cluster_id AND pc_cl.cluster_type = 'product'
    WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
      AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
      AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
      AND (p_market IS NULL OR s.market = ANY(p_market))
      AND (p_customer IS NULL OR s.customer_name = ANY(p_customer))
      AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
      AND (p_product_cluster IS NULL OR pc_cl.cluster_label = ANY(p_product_cluster))
      AND (s.product_group IS NULL OR s.product_group NOT IN (
          SELECT e.product_group FROM dw.dim_product_group_exclusions e
      ));

    -- Previous Period
    SELECT
        COALESCE(SUM(s.line_amount), 0),
        COALESCE(SUM(s.qty), 0)
    INTO v_prev_rev, v_prev_qty
    FROM mart.sales_enriched s
    LEFT JOIN dw.dim_product_cluster dpc ON dpc.product_id = s.product_id
    LEFT JOIN dw.dim_cluster pc_cl ON pc_cl.cluster_id = dpc.cluster_id AND pc_cl.cluster_type = 'product'
    WHERE s.invoice_date BETWEEN v_prev_start AND v_prev_end
      AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
      AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
      AND (p_market IS NULL OR s.market = ANY(p_market))
      AND (p_customer IS NULL OR s.customer_name = ANY(p_customer))
      AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
      AND (p_product_cluster IS NULL OR pc_cl.cluster_label = ANY(p_product_cluster))
      AND (s.product_group IS NULL OR s.product_group NOT IN (
          SELECT e.product_group FROM dw.dim_product_group_exclusions e
      ));

    RETURN QUERY SELECT
        'Selected Range'::text,
        v_curr_rev,
        v_prev_rev,
        v_curr_qty,
        v_prev_qty;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_yoy_comparison TO authenticated;

-- ============================================================================
-- 4. Update get_breakdown to support customer filter
-- ============================================================================
DROP FUNCTION IF EXISTS public.get_breakdown(text, date, date, text[], text[], text[], text[], text[], int);

CREATE OR REPLACE FUNCTION public.get_breakdown(
    p_dimension text,
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,
    p_market text[] DEFAULT NULL,
    p_customer text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL,
    p_product_cluster text[] DEFAULT NULL,
    p_limit int DEFAULT 10
)
RETURNS TABLE (
    label text,
    revenue numeric,
    quantity numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Handle product_cluster dimension specially - requires joining through dim_product_cluster
    IF p_dimension = 'product_cluster' THEN
        RETURN QUERY
        SELECT
            COALESCE(cl.cluster_label, 'Unclustered')::text AS label,
            SUM(se.line_amount) AS revenue,
            SUM(se.qty) AS quantity
        FROM mart.sales_enriched se
        LEFT JOIN dw.dim_product_cluster pc ON pc.product_id = se.product_id
        LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = pc.cluster_id AND cl.cluster_type = 'product'
        -- Also join for product cluster filter (different from dimension)
        LEFT JOIN dw.dim_product_cluster dpc_filter ON dpc_filter.product_id = se.product_id
        LEFT JOIN dw.dim_cluster pc_filter ON pc_filter.cluster_id = dpc_filter.cluster_id AND pc_filter.cluster_type = 'product'
        WHERE se.invoice_date BETWEEN p_start_date AND p_end_date
          AND (p_merchant_group IS NULL OR se.merchant_group = ANY(p_merchant_group))
          AND (p_product_group IS NULL OR se.item_name = ANY(p_product_group))
          AND (p_market IS NULL OR se.market = ANY(p_market))
          AND (p_customer IS NULL OR se.customer_name = ANY(p_customer))
          AND (p_cluster IS NULL OR se.cluster_label = ANY(p_cluster))
          AND (p_product_cluster IS NULL OR pc_filter.cluster_label = ANY(p_product_cluster))
          AND (se.product_group IS NULL OR se.product_group NOT IN (
              SELECT e.product_group FROM dw.dim_product_group_exclusions e
          ))
        GROUP BY cl.cluster_label
        ORDER BY revenue DESC
        LIMIT p_limit;
    ELSE
        -- For other dimensions, use a CTE approach for product cluster filtering
        RETURN QUERY
        WITH filtered_sales AS (
            SELECT
                se.*
            FROM mart.sales_enriched se
            LEFT JOIN dw.dim_product_cluster dpc ON dpc.product_id = se.product_id
            LEFT JOIN dw.dim_cluster pc_cl ON pc_cl.cluster_id = dpc.cluster_id AND pc_cl.cluster_type = 'product'
            WHERE se.invoice_date BETWEEN p_start_date AND p_end_date
              AND (p_merchant_group IS NULL OR se.merchant_group = ANY(p_merchant_group))
              AND (p_product_group IS NULL OR se.item_name = ANY(p_product_group))
              AND (p_market IS NULL OR se.market = ANY(p_market))
              AND (p_customer IS NULL OR se.customer_name = ANY(p_customer))
              AND (p_cluster IS NULL OR se.cluster_label = ANY(p_cluster))
              AND (p_product_cluster IS NULL OR pc_cl.cluster_label = ANY(p_product_cluster))
              AND (se.product_group IS NULL OR se.product_group NOT IN (
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
                    WHEN p_dimension = 'product_group' THEN fs.item_name
                    WHEN p_dimension = 'cluster' THEN fs.cluster_label
                    WHEN p_dimension = 'customer_cluster' THEN fs.cluster_label
                    ELSE fs.item_name
                END,
                'Unknown'
            )::text AS label,
            SUM(fs.line_amount) AS revenue,
            SUM(fs.qty) AS quantity
        FROM filtered_sales fs
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT p_limit;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_breakdown TO authenticated;
