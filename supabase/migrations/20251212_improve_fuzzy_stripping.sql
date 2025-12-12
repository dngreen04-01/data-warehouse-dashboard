-- Migration: 20251212_improve_fuzzy_stripping.sql
-- Purpose: Improve fuzzy matching by normalizing names (stripping prefixes like 'Local - 1:') before comparison.

-- Update customer matching
CREATE OR REPLACE FUNCTION public.get_customer_match_suggestions(p_threshold float DEFAULT 0.6, p_limit int DEFAULT 20)
RETURNS TABLE (
    master_id text,
    master_name text,
    suggestions jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH unmatched_raw AS (
        SELECT customer_id, customer_name 
        FROM dw.dim_customer 
        WHERE master_customer_id IS NULL 
        AND archived IS DISTINCT FROM true
    ),
    unmatched_norm AS (
        SELECT 
            customer_id, 
            customer_name,
            -- Normalization:
            -- 1. Remove 'Local - 1:', 'Local 1 -:', 'Local - 1 ' etc (case insensitive)
            -- 2. Replace ':' with ' - ' to match standard formatting
            -- 3. Trim whitespace
            TRIM(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        customer_name, 
                        '^(Local\s*[-]?\s*1\s*[-:]?)', 
                        '', 
                        'i'
                    ),
                    ':',
                    ' - ',
                    'g'
                )
            ) as clean_name
        FROM unmatched_raw
    ),
    pairs AS (
        SELECT 
            u1.customer_id as m_id,
            u1.customer_name as m_name,
            u2.customer_id as c_id,
            u2.customer_name as c_name,
            -- Compare the CLEANED names
            similarity(u1.clean_name, u2.clean_name) as sim_score
        FROM unmatched_norm u1
        JOIN unmatched_norm u2 ON u1.customer_id < u2.customer_id
        WHERE similarity(u1.clean_name, u2.clean_name) > p_threshold
    ),
    grouped AS (
        SELECT 
            m_id,
            m_name,
            jsonb_agg(
                jsonb_build_object(
                    'id', c_id, 
                    'name', c_name, 
                    'score', sim_score
                ) ORDER BY sim_score DESC
            ) as suggs
        FROM pairs
        GROUP BY m_id, m_name
    )
    SELECT 
        m_id, 
        m_name, 
        suggs
    FROM grouped
    ORDER BY jsonb_array_length(suggs) DESC
    LIMIT p_limit;
END;
$$;

-- Update product matching
CREATE OR REPLACE FUNCTION public.get_product_match_suggestions(p_threshold float DEFAULT 0.6, p_limit int DEFAULT 20)
RETURNS TABLE (
    master_id bigint,
    master_name text,
    suggestions jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH unmatched_raw AS (
        SELECT product_id, item_name, product_code
        FROM dw.dim_product 
        WHERE master_product_id IS NULL 
        AND archived IS DISTINCT FROM true
    ),
    unmatched_norm AS (
        SELECT 
            product_id, 
            item_name,
            product_code,
            -- Normalization:
            -- 1. Remove 'Local - 1:' etc
            -- 2. Replace ':' with ' - '
            TRIM(
                REGEXP_REPLACE(
                    REGEXP_REPLACE(
                        item_name, 
                        '^(Local\s*[-]?\s*1\s*[-:]?)', 
                        '', 
                        'i'
                    ),
                    ':',
                    ' - ',
                    'g'
                )
            ) as clean_name
        FROM unmatched_raw
    ),
    pairs AS (
        SELECT 
            u1.product_id as m_id,
            u1.item_name as m_name,
            u2.product_id as c_id,
            u2.item_name as c_name,
            u2.product_code as c_code,
            similarity(u1.clean_name, u2.clean_name) as sim_score
        FROM unmatched_norm u1
        JOIN unmatched_norm u2 ON u1.product_id < u2.product_id
        WHERE similarity(u1.clean_name, u2.clean_name) > p_threshold
    ),
    grouped AS (
        SELECT 
            m_id,
            m_name,
            jsonb_agg(
                jsonb_build_object(
                    'id', c_id, 
                    'name', c_name, 
                    'code', c_code,
                    'score', sim_score
                ) ORDER BY sim_score DESC
            ) as suggs
        FROM pairs
        GROUP BY m_id, m_name
    )
    SELECT 
        m_id, 
        m_name, 
        suggs
    FROM grouped
    ORDER BY jsonb_array_length(suggs) DESC
    LIMIT p_limit;
END;
$$;
