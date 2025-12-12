-- Product Group Filtering
-- Date: 2025-12-11
-- Purpose: Exclude non-revenue product groups from sales calculations

-- Create a table to store excluded product groups (easier to manage than hardcoding)
CREATE TABLE IF NOT EXISTS dw.dim_product_group_exclusions (
    product_group text PRIMARY KEY,
    reason text,
    created_at timestamptz DEFAULT timezone('utc', now())
);

-- Insert the excluded groups
INSERT INTO dw.dim_product_group_exclusions (product_group, reason) VALUES
    ('Freight', 'Non-revenue: shipping cost'),
    ('consumables', 'Non-revenue: internal consumables'),
    ('Pallet access for/sale', 'Non-revenue: pallet handling'),
    ('Commission', 'Non-revenue: commission payments'),
    ('contract', 'Non-revenue: contract fees'),
    ('documentation', 'Non-revenue: documentation fees'),
    ('risk', 'Non-revenue: risk fees'),
    ('Transport/mileage', 'Non-revenue: transport costs'),
    ('Load Building', 'Non-revenue: load building fees'),
    ('Container', 'Non-revenue: container fees'),
    ('Freight National', 'Non-revenue: national freight'),
    ('Fuel', 'Non-revenue: fuel costs')
ON CONFLICT (product_group) DO NOTHING;

GRANT SELECT ON dw.dim_product_group_exclusions TO authenticated;

-- 1. Update get_sales_overview to exclude non-revenue product groups
-- Note: p_product_group now filters by item_name (actual product names) not product_group (accounting categories)
DROP FUNCTION IF EXISTS public.get_sales_overview(date, date, text[], text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.get_sales_overview(
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,  -- This actually filters by item_name now
    p_market text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL
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
    WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
      AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
      -- Filter by item_name (actual products) instead of product_group (accounting categories)
      AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
      AND (p_market IS NULL OR s.market = ANY(p_market))
      AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
      -- Exclude non-revenue product groups (accounting categories like Freight, Commission, etc.)
      AND (s.product_group IS NULL OR s.product_group NOT IN (
          SELECT e.product_group FROM dw.dim_product_group_exclusions e
      ))
    GROUP BY s.invoice_date
    ORDER BY s.invoice_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_overview TO authenticated;

-- 2. Update get_breakdown to exclude non-revenue product groups
-- Note: p_product_group now filters by item_name (actual product names) not product_group (accounting categories)
DROP FUNCTION IF EXISTS public.get_breakdown(text, date, date, text[], text[], text[], text[], int);
CREATE OR REPLACE FUNCTION public.get_breakdown(
    p_dimension text,
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,  -- This actually filters by item_name now
    p_market text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL,
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
    RETURN QUERY
    EXECUTE format('
        SELECT
            COALESCE(%I, ''Unknown'')::text AS label,
            SUM(line_amount) AS revenue,
            SUM(qty) AS quantity
        FROM mart.sales_enriched
        WHERE invoice_date BETWEEN $1 AND $2
          AND ($3 IS NULL OR merchant_group = ANY($3))
          AND ($4 IS NULL OR item_name = ANY($4))
          AND ($5 IS NULL OR market = ANY($5))
          AND ($6 IS NULL OR cluster_label = ANY($6))
          AND (product_group IS NULL OR product_group NOT IN (
              SELECT e.product_group FROM dw.dim_product_group_exclusions e
          ))
        GROUP BY 1
        ORDER BY revenue DESC
        LIMIT $7
    ', CASE
        WHEN p_dimension = 'product' THEN 'item_name'
        WHEN p_dimension = 'customer' THEN 'customer_name'
        WHEN p_dimension = 'market' THEN 'market'
        WHEN p_dimension = 'merchant_group' THEN 'merchant_group'
        WHEN p_dimension = 'product_group' THEN 'item_name'  -- Show item_name for product_group dimension too
        WHEN p_dimension = 'cluster' THEN 'cluster_label'
        ELSE 'item_name'
       END)
    USING p_start_date, p_end_date, p_merchant_group, p_product_group, p_market, p_cluster, p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_breakdown TO authenticated;

-- 3. Update get_yoy_comparison to exclude non-revenue product groups
-- Note: p_product_group now filters by item_name (actual product names) not product_group (accounting categories)
DROP FUNCTION IF EXISTS public.get_yoy_comparison(date, date, text[], text[], text[], text[]);
CREATE OR REPLACE FUNCTION public.get_yoy_comparison(
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,  -- This actually filters by item_name now
    p_market text[] DEFAULT NULL,
    p_cluster text[] DEFAULT NULL
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
        COALESCE(SUM(line_amount), 0),
        COALESCE(SUM(qty), 0)
    INTO v_curr_rev, v_curr_qty
    FROM mart.sales_enriched s
    WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
      AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
      -- Filter by item_name (actual products) instead of product_group (accounting categories)
      AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
      AND (p_market IS NULL OR s.market = ANY(p_market))
      AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
      AND (s.product_group IS NULL OR s.product_group NOT IN (
          SELECT e.product_group FROM dw.dim_product_group_exclusions e
      ));

    -- Previous Period
    SELECT
        COALESCE(SUM(line_amount), 0),
        COALESCE(SUM(qty), 0)
    INTO v_prev_rev, v_prev_qty
    FROM mart.sales_enriched s
    WHERE s.invoice_date BETWEEN v_prev_start AND v_prev_end
      AND (p_merchant_group IS NULL OR s.merchant_group = ANY(p_merchant_group))
      -- Filter by item_name (actual products) instead of product_group (accounting categories)
      AND (p_product_group IS NULL OR s.item_name = ANY(p_product_group))
      AND (p_market IS NULL OR s.market = ANY(p_market))
      AND (p_cluster IS NULL OR s.cluster_label = ANY(p_cluster))
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

-- 4. Update get_budget_vs_actual to exclude non-revenue product groups
DROP FUNCTION IF EXISTS public.get_budget_vs_actual(date, date, text);
CREATE OR REPLACE FUNCTION public.get_budget_vs_actual(
    p_start_date date,
    p_end_date date,
    p_budget_name text DEFAULT NULL
)
RETURNS TABLE (
    month_date date,
    actual_revenue numeric,
    budget_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH monthly_sales AS (
        SELECT
            DATE_TRUNC('month', invoice_date)::date AS m_date,
            SUM(line_amount) AS revenue
        FROM mart.sales_enriched
        WHERE invoice_date BETWEEN p_start_date AND p_end_date
          AND (product_group IS NULL OR product_group NOT IN (
              SELECT e.product_group FROM dw.dim_product_group_exclusions e
          ))
        GROUP BY 1
    ),
    monthly_budget AS (
        SELECT
            b.month_date AS m_date,
            SUM(b.amount) AS budget
        FROM dw.fct_budget b
        WHERE b.month_date BETWEEN p_start_date AND p_end_date
          AND (p_budget_name IS NULL OR b.budget_name = p_budget_name)
        GROUP BY 1
    )
    SELECT
        COALESCE(s.m_date, b.m_date) AS month_date,
        COALESCE(s.revenue, 0) AS actual_revenue,
        COALESCE(b.budget, 0) AS budget_amount
    FROM monthly_sales s
    FULL OUTER JOIN monthly_budget b ON s.m_date = b.m_date
    ORDER BY month_date;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_budget_vs_actual TO authenticated;

-- 5. Update get_filter_options to use actual product names (item_name) instead of accounting categories
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
        -- Return actual product names (item_name) that have sales, instead of accounting categories (product_group)
        'product_groups', (
            SELECT ARRAY_AGG(item_name ORDER BY item_name)
            FROM (
                SELECT DISTINCT p.item_name
                FROM dw.dim_product p
                INNER JOIN dw.fct_sales_line sl ON sl.product_id = p.product_id
                WHERE p.item_name IS NOT NULL
                  AND p.item_name != ''
                  -- Exclude items from excluded product groups (accounting categories)
                  AND (p.product_group IS NULL OR p.product_group NOT IN (
                      SELECT e.product_group FROM dw.dim_product_group_exclusions e
                  ))
                ORDER BY p.item_name
                LIMIT 200  -- Reasonable limit for dropdown performance
            ) sub
        ),
        'merchant_groups', (SELECT ARRAY_AGG(DISTINCT merchant_group) FROM dw.dim_customer WHERE merchant_group IS NOT NULL),
        'clusters', (SELECT ARRAY_AGG(DISTINCT cluster_label) FROM dw.dim_cluster)
    ) INTO v_result;
    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_filter_options TO authenticated;

-- 6. Update the debug function to show which groups are excluded
DROP FUNCTION IF EXISTS public.get_sales_lines_debug(date, date);
CREATE OR REPLACE FUNCTION public.get_sales_lines_debug(
    p_start_date date,
    p_end_date date
)
RETURNS TABLE(
    sales_line_id bigint,
    invoice_number text,
    invoice_date date,
    document_type text,
    customer_id text,
    customer_name text,
    product_code text,
    item_name text,
    qty numeric,
    line_amount numeric,
    load_source text,
    product_group text,
    is_excluded boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        sl.sales_line_id,
        sl.invoice_number,
        sl.invoice_date,
        sl.document_type,
        sl.customer_id,
        sl.customer_name,
        sl.product_code,
        sl.item_name,
        sl.qty,
        sl.line_amount,
        sl.load_source,
        p.product_group,
        CASE WHEN e.product_group IS NOT NULL THEN true ELSE false END AS is_excluded
    FROM dw.fct_sales_line sl
    LEFT JOIN dw.dim_product p ON sl.product_code = p.product_code
    LEFT JOIN dw.dim_product_group_exclusions e ON p.product_group = e.product_group
    WHERE sl.invoice_date BETWEEN p_start_date AND p_end_date
    ORDER BY sl.line_amount DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_lines_debug(date, date) TO anon, authenticated;

-- 7. Add RPC to manage exclusions (for future admin use)
CREATE OR REPLACE FUNCTION public.get_excluded_product_groups()
RETURNS TABLE(
    product_group text,
    reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT e.product_group, e.reason
    FROM dw.dim_product_group_exclusions e
    ORDER BY e.product_group;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_excluded_product_groups() TO authenticated;
