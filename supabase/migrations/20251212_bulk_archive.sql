-- Migration: 20251212_bulk_archive.sql
-- Purpose: Support bulk archiving of products/customers and exclude them from all analytics.

-- 1. Drop views to rebuild dependencies
DROP VIEW IF EXISTS mart.sales_by_dimension CASCADE;
DROP VIEW IF EXISTS mart.daily_sales CASCADE;
DROP VIEW IF EXISTS mart.kpi_period_comparison CASCADE;
DROP VIEW IF EXISTS mart.sales_enriched CASCADE;

-- 2. Recreate mart.sales_enriched with Archive Logic
CREATE OR REPLACE VIEW mart.sales_enriched AS
SELECT
    sl.sales_line_id,
    sl.invoice_number,
    sl.invoice_date,
    sl.document_type,
    
    -- Customer Logic
    sl.customer_id as original_customer_id,
    COALESCE(mc.customer_id, c.customer_id) as customer_id,
    COALESCE(mc.customer_name, c.customer_name) as customer_name,
    COALESCE(mc.market, c.market) as market,
    COALESCE(mc.merchant_group, c.merchant_group) as merchant_group,
    
    -- Cluster Logic
    cc.cluster_id,
    cl.cluster_label,
    
    -- Product Logic
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
    -- Exclude if Product or Master Product is archived
    (p.archived IS DISTINCT FROM true) 
    AND (mp.archived IS DISTINCT FROM true OR mp.product_id IS NULL)
    -- Exclude if Customer or Master Customer is archived
    AND (c.archived IS DISTINCT FROM true)
    AND (mc.archived IS DISTINCT FROM true OR mc.customer_id IS NULL);

-- 3. Recreate Dependent Views using sales_enriched to ensure consistency

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
    FROM mart.sales_enriched -- NOW USES ENRICHED (Filtered)
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


-- 4. Update Existing RPCs to hide archived items from "Unmatched" lists

DROP FUNCTION IF EXISTS public.get_unmatched_products(text);
CREATE OR REPLACE FUNCTION public.get_unmatched_products(p_search text DEFAULT NULL)
RETURNS TABLE (
    product_id bigint,
    item_name text,
    product_code text,
    load_source text
) 
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.product_id,
        p.item_name,
        p.product_code,
        'system'::text
    FROM dw.dim_product p
    WHERE p.master_product_id IS NULL
    AND p.archived IS DISTINCT FROM true -- Exclude archived
    AND (p_search IS NULL OR p.item_name ILIKE '%' || p_search || '%' OR p.product_code ILIKE '%' || p_search || '%')
    ORDER BY p.item_name
    LIMIT 100;
END;
$$;

DROP FUNCTION IF EXISTS public.get_unmatched_customers(text);
CREATE OR REPLACE FUNCTION public.get_unmatched_customers(p_search text DEFAULT NULL)
RETURNS TABLE (
    customer_id text,
    customer_name text
) 
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.customer_id,
        c.customer_name
    FROM dw.dim_customer c
    WHERE c.master_customer_id IS NULL
    AND c.archived IS DISTINCT FROM true -- Exclude archived
    AND (p_search IS NULL OR c.customer_name ILIKE '%' || p_search || '%')
    ORDER BY c.customer_name
    LIMIT 100;
END;
$$;

-- 5. Add Archive RPCs

CREATE OR REPLACE FUNCTION public.archive_products(p_product_ids bigint[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE dw.dim_product
    SET archived = true
    WHERE product_id = ANY(p_product_ids);
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_customers(p_customer_ids text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE dw.dim_customer
    SET archived = true
    WHERE customer_id = ANY(p_customer_ids);
END;
$$;

-- Function to get items for the Archive Tab (active items, can be matched or unmatched, but mainly we want to find noise)
-- We'll just reuse get_unmatched_products for now since "noise" is usually unmatched.
-- But let's create a specific one that might be broader if needed, or just stick to the existing one.
-- User said "old historic products... bulk archive".
-- If we just use get_unmatched_products, it covers the "noise" case well.

GRANT EXECUTE ON FUNCTION public.get_unmatched_products TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_customers TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_products TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_customers TO authenticated;
