-- Migration: 20251212_pagination.sql
-- Purpose: Add pagination support to maintenance RPCs

-- 1. Update get_unmatched_products with pagination
DROP FUNCTION IF EXISTS public.get_unmatched_products(text);
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
    AND (p_search IS NULL OR p.item_name ILIKE '%' || p_search || '%' OR p.product_code ILIKE '%' || p_search || '%')
    ORDER BY p.item_name
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 2. Update get_unmatched_customers with pagination
DROP FUNCTION IF EXISTS public.get_unmatched_customers(text);
CREATE OR REPLACE FUNCTION public.get_unmatched_customers(
    p_search text DEFAULT NULL,
    p_limit int DEFAULT 100,
    p_offset int DEFAULT 0
)
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
    AND c.archived IS DISTINCT FROM true
    AND (p_search IS NULL OR c.customer_name ILIKE '%' || p_search || '%')
    ORDER BY c.customer_name
    LIMIT p_limit OFFSET p_offset;
END;
$$;

-- 3. Add Count Functions
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
    AND (p_search IS NULL OR p.item_name ILIKE '%' || p_search || '%' OR p.product_code ILIKE '%' || p_search || '%');
    
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_unmatched_customers_count(p_search text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_count bigint;
BEGIN
    SELECT COUNT(*)
    INTO v_count
    FROM dw.dim_customer c
    WHERE c.master_customer_id IS NULL
    AND c.archived IS DISTINCT FROM true
    AND (p_search IS NULL OR c.customer_name ILIKE '%' || p_search || '%');
    
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_unmatched_products(text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_customers(text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_products_count(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_unmatched_customers_count(text) TO authenticated;
