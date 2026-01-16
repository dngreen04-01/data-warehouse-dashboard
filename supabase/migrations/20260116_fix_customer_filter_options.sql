-- Fix: Customer filter should exclude merged (child) and archived customers
-- Date: 2026-01-16
-- Problem: Merged customers appear as separate lines on the dashboard because both
--          master and child customers are returned in the filter dropdown.
--          e.g., "Local - 1:PGG Wrightson Ltd:Hastings" and "PGG Wrightson Ltd - Hastings"
--          both appear when they should be merged into one.
--
-- Also ensures the sales_enriched view correctly merges child customer sales into master.

-- ============================================================================
-- 1. Recreate sales_enriched view with correct merge logic
-- ============================================================================

DROP VIEW IF EXISTS mart.sales_by_dimension CASCADE;
DROP VIEW IF EXISTS mart.daily_sales CASCADE;
DROP VIEW IF EXISTS mart.kpi_period_comparison CASCADE;
DROP VIEW IF EXISTS mart.sales_enriched CASCADE;

CREATE OR REPLACE VIEW mart.sales_enriched AS
SELECT
    sl.sales_line_id,
    sl.invoice_number,
    sl.invoice_date,
    sl.document_type,

    -- Customer Logic: Use master if available, otherwise original
    sl.customer_id as original_customer_id,
    COALESCE(mc.customer_id, c.customer_id) as customer_id,
    COALESCE(mc.customer_name, c.customer_name) as customer_name,
    COALESCE(mc.market, c.market) as market,
    COALESCE(mc.merchant_group, c.merchant_group) as merchant_group,

    -- Cluster Logic: Use master customer's cluster if available
    cc.cluster_id,
    cl.cluster_label,

    -- Product Logic: Use master if available, otherwise original
    sl.product_id as original_product_id,
    COALESCE(mp.product_id, p.product_id) as product_id,
    COALESCE(mp.product_code, p.product_code) as product_code,
    COALESCE(mp.item_name, p.item_name) as item_name,
    COALESCE(mp.product_group, p.product_group) as product_group,

    sl.qty,
    sl.unit_price,
    sl.line_amount,
    sl.load_source,
    sl.loaded_at
FROM dw.fct_sales_line sl
LEFT JOIN dw.dim_customer c ON c.customer_id = sl.customer_id
LEFT JOIN dw.dim_customer mc ON mc.customer_id = c.master_customer_id
LEFT JOIN dw.dim_customer_cluster cc ON cc.customer_id = COALESCE(mc.customer_id, c.customer_id)
LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = cc.cluster_id
LEFT JOIN dw.dim_product p ON p.product_id = sl.product_id
LEFT JOIN dw.dim_product mp ON mp.product_id = p.master_product_id
WHERE
    -- Product filtering: exclude archived products (unless they have an active master)
    p.archived IS DISTINCT FROM true
    AND (mp.archived IS DISTINCT FROM true OR mp.product_id IS NULL)
    -- Customer filtering: ALLOW archived IF merged to an active master
    -- This is the key fix - merged children should contribute their sales to the master
    AND (c.archived IS DISTINCT FROM true OR c.master_customer_id IS NOT NULL)
    -- Master customer must not be archived (if present)
    AND (mc.archived IS DISTINCT FROM true OR mc.customer_id IS NULL);

-- Recreate dependent views
CREATE OR REPLACE VIEW mart.daily_sales AS
SELECT
    invoice_date,
    sum(line_amount) as revenue,
    sum(qty) as qty_sold,
    count(distinct invoice_number) as invoice_count,
    min(loaded_at) as first_loaded_at,
    max(loaded_at) as last_loaded_at
FROM mart.sales_enriched
GROUP BY invoice_date;

CREATE OR REPLACE VIEW mart.sales_by_dimension AS
SELECT
    invoice_date,
    customer_id,
    product_id,
    product_code,
    coalesce(cluster_id, -1) as cluster_id,
    coalesce(market, 'Unknown') as market,
    coalesce(merchant_group, 'Unknown') as merchant_group,
    sum(line_amount) as revenue,
    sum(qty) as qty_sold
FROM mart.sales_enriched
GROUP BY 1,2,3,4,5,6,7;

CREATE OR REPLACE VIEW mart.kpi_period_comparison AS
WITH base AS (
    SELECT
        invoice_date,
        date_part('year', invoice_date)::int as cal_year,
        date_part('month', invoice_date)::int as cal_month,
        date_part('week', invoice_date)::int as cal_week,
        sum(line_amount) as revenue,
        sum(qty) as qty_sold
    FROM mart.sales_enriched
    GROUP BY 1
)
SELECT
    b.invoice_date,
    b.cal_year,
    b.cal_month,
    b.cal_week,
    b.revenue,
    b.qty_sold,
    sum(b.revenue) OVER (PARTITION BY b.cal_year ORDER BY b.invoice_date) as revenue_ytd,
    sum(b.qty_sold) OVER (PARTITION BY b.cal_year ORDER BY b.invoice_date) as qty_ytd,
    sum(b.revenue) OVER (PARTITION BY b.cal_year, b.cal_month ORDER BY b.invoice_date) as revenue_mtd,
    sum(b.revenue) OVER (PARTITION BY b.cal_year, b.cal_week ORDER BY b.invoice_date) as revenue_wtd
FROM base b;

-- Grant permissions on views
GRANT SELECT ON mart.sales_enriched TO anon, authenticated;
GRANT SELECT ON mart.daily_sales TO anon, authenticated;
GRANT SELECT ON mart.sales_by_dimension TO anon, authenticated;
GRANT SELECT ON mart.kpi_period_comparison TO anon, authenticated;

-- ============================================================================
-- 2. Fix get_filter_options to exclude merged/archived customers
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
        -- FIXED: Only return master customers (not merged children) that are not archived
        -- Previously this included all customers, causing merged pairs to show as separate lines
        'customers', (
            SELECT ARRAY_AGG(customer_name ORDER BY customer_name)
            FROM dw.dim_customer
            WHERE customer_name IS NOT NULL
              AND customer_name != ''
              AND (market IS NOT NULL OR merchant_group IS NOT NULL)
              AND master_customer_id IS NULL  -- Exclude merged child customers
              AND (archived IS DISTINCT FROM true)  -- Exclude archived customers
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
-- 3. Flatten multi-level merge chains (one-time data fix)
-- ============================================================================
-- Problem: Some customers have chains like A → B → C where A's sales should
-- roll up to C, but the view only follows one level. This flattens all chains
-- so every customer points directly to the ultimate root/master.

WITH RECURSIVE customer_roots AS (
    -- Base: customers with no master (they ARE roots)
    SELECT customer_id, customer_id as root_id, 0 as depth
    FROM dw.dim_customer
    WHERE master_customer_id IS NULL

    UNION ALL

    -- Recursive: follow master_customer_id chain to find root
    SELECT c.customer_id, cr.root_id, cr.depth + 1
    FROM dw.dim_customer c
    JOIN customer_roots cr ON c.master_customer_id = cr.customer_id
    WHERE cr.depth < 10  -- Safety limit to prevent infinite loops
)
UPDATE dw.dim_customer c
SET master_customer_id = cr.root_id
FROM customer_roots cr
WHERE c.customer_id = cr.customer_id
  AND c.master_customer_id IS NOT NULL  -- Only update non-roots
  AND c.master_customer_id != cr.root_id;  -- Only if currently pointing to intermediate

-- ============================================================================
-- 4. Update match_customers() to prevent future chains
-- ============================================================================
-- When merging B into A, also re-parent any customers that had B as their master
-- to point directly to A. This keeps the data flat.

DROP FUNCTION IF EXISTS public.match_customers(text, text[]);

CREATE OR REPLACE FUNCTION public.match_customers(p_master_id text, p_child_ids text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Set master for direct children being merged
    UPDATE dw.dim_customer
    SET master_customer_id = p_master_id
    WHERE customer_id = ANY(p_child_ids)
    AND customer_id != p_master_id;

    -- Also re-parent any grandchildren (customers that had one of the children as their master)
    -- This prevents chains from forming
    UPDATE dw.dim_customer
    SET master_customer_id = p_master_id
    WHERE master_customer_id = ANY(p_child_ids)
    AND customer_id != p_master_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.match_customers TO authenticated;
