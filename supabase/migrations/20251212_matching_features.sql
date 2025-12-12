-- Migration: 20251212_matching_features.sql
-- Purpose: Add product/customer matching (aliasing) and update analytics views to use canonical entities.

-- 1. Add Master/Canonical Reference Columns
ALTER TABLE dw.dim_product ADD COLUMN IF NOT EXISTS master_product_id bigint REFERENCES dw.dim_product(product_id);
ALTER TABLE dw.dim_customer ADD COLUMN IF NOT EXISTS master_customer_id text REFERENCES dw.dim_customer(customer_id);

CREATE INDEX IF NOT EXISTS idx_dim_product_master ON dw.dim_product(master_product_id);
CREATE INDEX IF NOT EXISTS idx_dim_customer_master ON dw.dim_customer(master_customer_id);

-- 2. Update Analytics Views to Use Canonical References
-- We need to drop dependent views first or use CASCADE.
DROP VIEW IF EXISTS mart.sales_enriched CASCADE;

-- Recreate mart.sales_enriched with canonical logic
CREATE OR REPLACE VIEW mart.sales_enriched AS
SELECT
    sl.sales_line_id,
    sl.invoice_number,
    sl.invoice_date,
    sl.document_type,
    
    -- Customer Logic
    sl.customer_id as original_customer_id,
    COALESCE(mc.customer_id, c.customer_id) as customer_id, -- Canonical ID
    COALESCE(mc.customer_name, c.customer_name) as customer_name,
    COALESCE(mc.market, c.market) as market,
    COALESCE(mc.merchant_group, c.merchant_group) as merchant_group,
    
    -- Cluster Logic (based on canonical customer)
    cc.cluster_id,
    cl.cluster_label,
    
    -- Product Logic
    sl.product_id as original_product_id,
    COALESCE(mp.product_id, p.product_id) as product_id, -- Canonical ID
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
LEFT JOIN dw.dim_customer mc ON mc.customer_id = c.master_customer_id -- Resolve Master Customer
LEFT JOIN dw.dim_customer_cluster cc ON cc.customer_id = COALESCE(mc.customer_id, c.customer_id) -- Cluster of Canonical Customer
LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = cc.cluster_id
LEFT JOIN dw.dim_product p ON p.product_id = sl.product_id
LEFT JOIN dw.dim_product mp ON mp.product_id = p.master_product_id; -- Resolve Master Product

-- Recreate dependent views (copied/adapted from views.sql)

create or replace view mart.daily_sales as
select
    invoice_date,
    sum(line_amount) as revenue,
    sum(qty) as qty_sold,
    count(distinct invoice_number) as invoice_count,
    min(loaded_at) as first_loaded_at,
    max(loaded_at) as last_loaded_at
from dw.fct_sales_line -- Note: Daily sales aggregates raw lines, usually fine to keep as is unless we want canonical grouping here? 
-- Actually, the original view used fct_sales_line directly. Revenue totals don't change with aliasing, only grouping.
-- So we can leave it pointing to fct_sales_line or point to sales_enriched. 
-- The original pointed to fct_sales_line. I will stick to that to minimize side effects, 
-- but wait, if we want to filter by "Canonical Product Group" later, we might need sales_enriched.
-- However, `mart.daily_sales` has no dimension columns other than date. So it is safe.
group by invoice_date;

create or replace view mart.sales_by_dimension as
select
    invoice_date,
    customer_id, -- Now this will be the canonical ID from enriched
    product_id, -- Canonical ID from enriched
    product_code, -- Canonical code
    coalesce(cluster_id, -1) as cluster_id,
    coalesce(market, 'Unknown') as market,
    coalesce(merchant_group, 'Unknown') as merchant_group,
    sum(line_amount) as revenue,
    sum(qty) as qty_sold
from mart.sales_enriched
group by 1,2,3,4,5,6,7;

create or replace view mart.kpi_period_comparison as
with base as (
    select
        invoice_date,
        date_part('year', invoice_date)::int as cal_year,
        date_part('month', invoice_date)::int as cal_month,
        date_part('week', invoice_date)::int as cal_week,
        sum(line_amount) as revenue,
        sum(qty) as qty_sold
    from dw.fct_sales_line -- Again, total revenue doesn't change with aliasing.
    group by 1
)
select
    b.invoice_date,
    b.cal_year,
    b.cal_month,
    b.cal_week,
    b.revenue,
    b.qty_sold,
    sum(b.revenue) over (partition by b.cal_year order by b.invoice_date) as revenue_ytd,
    sum(b.qty_sold) over (partition by b.cal_year order by b.invoice_date) as qty_ytd,
    sum(b.revenue) over (partition by b.cal_year, b.cal_month order by b.invoice_date) as revenue_mtd,
    sum(b.revenue) over (partition by b.cal_year, b.cal_week order by b.invoice_date) as revenue_wtd
from base b;

-- 3. Create RPCs for Maintenance UI

-- Get Unmatched Products (Potential children)
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
        -- Try to determine source from existing data or assumptions (dw.dim_product doesn't have load_source, but fct_sales_line does. We can infer or just return null)
        'system'::text as load_source
    FROM dw.dim_product p
    WHERE p.master_product_id IS NULL
    AND (p_search IS NULL OR p.item_name ILIKE '%' || p_search || '%' OR p.product_code ILIKE '%' || p_search || '%')
    ORDER BY p.item_name
    LIMIT 100;
END;
$$;

-- Get Product Groups (Matches)
CREATE OR REPLACE FUNCTION public.get_product_matches()
RETURNS TABLE (
    master_id bigint,
    master_name text,
    child_count bigint,
    children jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.product_id as master_id,
        p.item_name as master_name,
        count(c.product_id) as child_count,
        jsonb_agg(jsonb_build_object('id', c.product_id, 'name', c.item_name, 'code', c.product_code)) as children
    FROM dw.dim_product p
    JOIN dw.dim_product c ON c.master_product_id = p.product_id
    GROUP BY p.product_id, p.item_name
    ORDER BY p.item_name;
END;
$$;

-- Match Products
CREATE OR REPLACE FUNCTION public.match_products(p_master_id bigint, p_child_ids bigint[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE dw.dim_product
    SET master_product_id = p_master_id
    WHERE product_id = ANY(p_child_ids)
    AND product_id != p_master_id; -- Prevent self-referencing loop if included
END;
$$;

-- Unmatch Product
CREATE OR REPLACE FUNCTION public.unmatch_product(p_product_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE dw.dim_product
    SET master_product_id = NULL
    WHERE product_id = p_product_id;
END;
$$;

-- Customer RPCs (Mirroring Product Logic)

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
    AND (p_search IS NULL OR c.customer_name ILIKE '%' || p_search || '%')
    ORDER BY c.customer_name
    LIMIT 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_customer_matches()
RETURNS TABLE (
    master_id text,
    master_name text,
    child_count bigint,
    children jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT 
        c.customer_id as master_id,
        c.customer_name as master_name,
        count(sub.customer_id) as child_count,
        jsonb_agg(jsonb_build_object('id', sub.customer_id, 'name', sub.customer_name)) as children
    FROM dw.dim_customer c
    JOIN dw.dim_customer sub ON sub.master_customer_id = c.customer_id
    GROUP BY c.customer_id, c.customer_name
    ORDER BY c.customer_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.match_customers(p_master_id text, p_child_ids text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE dw.dim_customer
    SET master_customer_id = p_master_id
    WHERE customer_id = ANY(p_child_ids)
    AND customer_id != p_master_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.unmatch_customer(p_customer_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE dw.dim_customer
    SET master_customer_id = NULL
    WHERE customer_id = p_customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unmatched_products TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_matches TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_products TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmatch_product TO authenticated;

GRANT EXECUTE ON FUNCTION public.get_unmatched_customers TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_customer_matches TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_customers TO authenticated;
GRANT EXECUTE ON FUNCTION public.unmatch_customer TO authenticated;
