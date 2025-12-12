-- Filter Options: Separate Customer and Product Clusters
-- Date: 2025-12-12
-- Purpose: Update get_filter_options to return both customer_clusters and product_clusters

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
