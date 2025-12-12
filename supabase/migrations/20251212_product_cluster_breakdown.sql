-- Product Cluster Breakdown Support
-- Date: 2025-12-12
-- Purpose: Add support for product_cluster breakdown dimension in get_breakdown

-- Update get_breakdown to support product_cluster dimension
DROP FUNCTION IF EXISTS public.get_breakdown(text, date, date, text[], text[], text[], text[], int);
CREATE OR REPLACE FUNCTION public.get_breakdown(
    p_dimension text,
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] DEFAULT NULL,
    p_product_group text[] DEFAULT NULL,
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
    -- Handle product_cluster specially - requires joining through dim_product_cluster
    IF p_dimension = 'product_cluster' THEN
        RETURN QUERY
        SELECT
            COALESCE(cl.cluster_label, 'Unclustered')::text AS label,
            SUM(se.line_amount) AS revenue,
            SUM(se.qty) AS quantity
        FROM mart.sales_enriched se
        LEFT JOIN dw.dim_product_cluster pc ON pc.product_id = se.product_id
        LEFT JOIN dw.dim_cluster cl ON cl.cluster_id = pc.cluster_id
        WHERE se.invoice_date BETWEEN p_start_date AND p_end_date
          AND (p_merchant_group IS NULL OR se.merchant_group = ANY(p_merchant_group))
          AND (p_product_group IS NULL OR se.item_name = ANY(p_product_group))
          AND (p_market IS NULL OR se.market = ANY(p_market))
          AND (p_cluster IS NULL OR se.cluster_label = ANY(p_cluster))
          AND (se.product_group IS NULL OR se.product_group NOT IN (
              SELECT e.product_group FROM dw.dim_product_group_exclusions e
          ))
        GROUP BY cl.cluster_label
        ORDER BY revenue DESC
        LIMIT p_limit;
    ELSE
        -- Use dynamic query for other dimensions
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
            WHEN p_dimension = 'product_group' THEN 'item_name'
            WHEN p_dimension = 'cluster' THEN 'cluster_label'
            WHEN p_dimension = 'customer_cluster' THEN 'cluster_label'
            ELSE 'item_name'
           END)
        USING p_start_date, p_end_date, p_merchant_group, p_product_group, p_market, p_cluster, p_limit;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_breakdown TO authenticated;
