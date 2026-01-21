-- =============================================================================
-- Migration: 20260121_exclude_wip_from_reports.sql
-- Purpose: Exclude WIP (work-in-progress) products from reports, price lists,
--          and general product listings. WIP products should only appear in
--          the supplier portal's WIP section and cluster analytics.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Update mart.sales_enriched view to exclude WIP products
-- -----------------------------------------------------------------------------
-- Drop dependent views first
DROP VIEW IF EXISTS mart.sales_by_dimension CASCADE;
DROP VIEW IF EXISTS mart.daily_sales CASCADE;
DROP VIEW IF EXISTS mart.kpi_period_comparison CASCADE;
DROP VIEW IF EXISTS mart.sales_enriched CASCADE;

-- Recreate mart.sales_enriched with WIP exclusion
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
    -- Exclude WIP products (NEW)
    AND (p.product_type IS DISTINCT FROM 'wip')
    AND (mp.product_type IS DISTINCT FROM 'wip' OR mp.product_id IS NULL)
    -- Customer filtering: ALLOW archived IF merged to an active master
    -- This ensures merged customer sales roll up to the master
    AND (c.archived IS DISTINCT FROM true OR c.master_customer_id IS NOT NULL)
    -- Master customer must not be archived (if present)
    AND (mc.archived IS DISTINCT FROM true OR mc.customer_id IS NULL);

-- Recreate dependent views using sales_enriched

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

-- -----------------------------------------------------------------------------
-- 2. Update get_products_for_supplier_stock RPC to only return finished products
--    (WIP products are handled separately in the supplier portal)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_products_for_supplier_stock()
RETURNS TABLE (
    product_id bigint,
    product_code text,
    item_name text,
    cluster_id integer,
    cluster_label text
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.product_id,
        p.product_code,
        p.item_name,
        c.cluster_id,
        c.cluster_label
    FROM dw.dim_product p
    LEFT JOIN dw.dim_product_cluster pc ON p.product_id = pc.product_id
    LEFT JOIN dw.dim_cluster c ON pc.cluster_id = c.cluster_id AND c.cluster_type = 'product'
    WHERE p.archived = false
      AND p.is_tracked_as_inventory = true
      AND (p.product_type IS NULL OR p.product_type = 'finished')  -- Exclude WIP
    ORDER BY c.cluster_label NULLS LAST, p.item_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

COMMENT ON FUNCTION public.get_products_for_supplier_stock IS
'Returns finished inventory-tracked products grouped by product cluster for supplier stock entry. Excludes WIP products.';

-- -----------------------------------------------------------------------------
-- 3. Update get_supplier_stock_entries RPC to only return finished products
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_stock_entries(p_user_id uuid)
RETURNS TABLE (
    product_id bigint,
    current_week_qty integer,
    previous_week_qty integer
) AS $$
DECLARE
    v_current_week date;
    v_previous_week date;
BEGIN
    v_current_week := dw.get_week_ending(CURRENT_DATE);
    v_previous_week := v_current_week - 7;

    RETURN QUERY
    SELECT
        p.product_id,
        curr.quantity_on_hand as current_week_qty,
        prev.quantity_on_hand as previous_week_qty
    FROM dw.dim_product p
    LEFT JOIN dw.supplier_stock_entry curr
        ON p.product_id = curr.product_id
        AND curr.user_id = p_user_id
        AND curr.week_ending = v_current_week
    LEFT JOIN dw.supplier_stock_entry prev
        ON p.product_id = prev.product_id
        AND prev.user_id = p_user_id
        AND prev.week_ending = v_previous_week
    WHERE p.archived = false
      AND p.is_tracked_as_inventory = true
      AND (p.product_type IS NULL OR p.product_type = 'finished');  -- Exclude WIP
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

COMMENT ON FUNCTION public.get_supplier_stock_entries IS
'Returns current and previous week stock entries for finished products. Excludes WIP products.';

-- -----------------------------------------------------------------------------
-- 4. Update get_unmatched_products RPC to exclude WIP products
--    (paginated version with text, int, int signature)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unmatched_products(
    p_search text DEFAULT NULL,
    p_limit int DEFAULT 100,
    p_offset int DEFAULT 0
)
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
    AND p.archived IS DISTINCT FROM true
    AND (p.product_type IS NULL OR p.product_type = 'finished')  -- Exclude WIP
    AND (p_search IS NULL OR p.item_name ILIKE '%' || p_search || '%' OR p.product_code ILIKE '%' || p_search || '%')
    ORDER BY p.item_name
    LIMIT p_limit OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_unmatched_products(text, int, int) IS
'Returns unmatched finished products for product matching UI. Excludes WIP and archived products.';

-- -----------------------------------------------------------------------------
-- 5. Update get_unmatched_products_count RPC to exclude WIP products
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_unmatched_products_count(p_search text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_count bigint;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM dw.dim_product p
    WHERE p.master_product_id IS NULL
    AND p.archived IS DISTINCT FROM true
    AND (p.product_type IS NULL OR p.product_type = 'finished')  -- Exclude WIP
    AND (p_search IS NULL OR p.item_name ILIKE '%' || p_search || '%' OR p.product_code ILIKE '%' || p_search || '%');

    RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.get_unmatched_products_count IS
'Returns count of unmatched finished products. Excludes WIP and archived products.';

-- -----------------------------------------------------------------------------
-- 6. Add get_wip_stock_entries RPC for supplier portal
--    WIP products need separate stock entry fetching since get_supplier_stock_entries
--    now only returns finished products
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_wip_stock_entries(p_user_id uuid)
RETURNS TABLE (
    product_id bigint,
    current_week_qty integer,
    previous_week_qty integer
) AS $$
DECLARE
    v_current_week date;
    v_previous_week date;
BEGIN
    v_current_week := dw.get_week_ending(CURRENT_DATE);
    v_previous_week := v_current_week - 7;

    RETURN QUERY
    SELECT
        p.product_id,
        curr.quantity_on_hand as current_week_qty,
        prev.quantity_on_hand as previous_week_qty
    FROM dw.dim_product p
    LEFT JOIN dw.supplier_stock_entry curr
        ON p.product_id = curr.product_id
        AND curr.user_id = p_user_id
        AND curr.week_ending = v_current_week
    LEFT JOIN dw.supplier_stock_entry prev
        ON p.product_id = prev.product_id
        AND prev.user_id = p_user_id
        AND prev.week_ending = v_previous_week
    WHERE p.archived = false
      AND p.product_type = 'wip';  -- Only WIP products
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

COMMENT ON FUNCTION public.get_wip_stock_entries IS
'Returns current and previous week stock entries for WIP products only. Used by supplier portal.';
