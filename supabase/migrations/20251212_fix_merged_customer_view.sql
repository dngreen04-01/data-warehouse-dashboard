-- Fix: Allow merged (archived) customers to appear in sales_enriched
-- Date: 2025-12-12
-- Problem: Customers merged to a master were archived, but the view excluded ALL archived customers,
--          hiding their sales even though the master customer is active.
-- Solution: Allow archived customers IF they have a master_customer_id (merged), exclude only truly archived.

-- 1. Drop dependent views first
DROP VIEW IF EXISTS mart.sales_by_dimension CASCADE;
DROP VIEW IF EXISTS mart.daily_sales CASCADE;
DROP VIEW IF EXISTS mart.kpi_period_comparison CASCADE;
DROP VIEW IF EXISTS mart.sales_enriched CASCADE;

-- 2. Recreate mart.sales_enriched with CORRECTED Archive Logic
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
    -- Customer filtering: FIXED - allow archived IF merged to an active master
    -- Old (broken): c.archived IS DISTINCT FROM true
    -- New (fixed): Allow archived customers if they have a master_customer_id (i.e., they were merged)
    AND (c.archived IS DISTINCT FROM true OR c.master_customer_id IS NOT NULL)
    -- Master customer must not be archived (if present)
    AND (mc.archived IS DISTINCT FROM true OR mc.customer_id IS NULL);

-- 3. Recreate Dependent Views

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

-- 4. Grant permissions
GRANT SELECT ON mart.sales_enriched TO anon, authenticated;
GRANT SELECT ON mart.daily_sales TO anon, authenticated;
GRANT SELECT ON mart.sales_by_dimension TO anon, authenticated;
GRANT SELECT ON mart.kpi_period_comparison TO anon, authenticated;
