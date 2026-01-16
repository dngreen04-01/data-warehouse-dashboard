-- Add master_customer_id to get_customers_with_clusters RPC
-- Enables frontend to filter for discrete customers only (masters + unmerged)
-- Date: 2026-01-16

DROP FUNCTION IF EXISTS public.get_customers_with_clusters();

CREATE OR REPLACE FUNCTION public.get_customers_with_clusters()
RETURNS TABLE (
    customer_id text,
    customer_name text,
    contact_name text,
    bill_to text,
    market text,
    merchant_group text,
    customer_type text,
    balance_total numeric,
    archived boolean,
    master_customer_id text,
    cluster_id int,
    cluster_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.customer_id,
        c.customer_name,
        c.contact_name,
        c.bill_to,
        c.market,
        c.merchant_group,
        c.customer_type,
        c.balance_total,
        c.archived,
        c.master_customer_id,
        cl.cluster_id,
        cl.cluster_label
    FROM dw.dim_customer c
    LEFT JOIN dw.dim_customer_cluster cc ON cc.customer_id = c.customer_id
    LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = cc.cluster_id
    WHERE c.archived = false
    ORDER BY c.customer_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_customers_with_clusters() TO authenticated;
