-- Migration: 20251212_fuzzy_matching.sql
-- Purpose: Add fuzzy matching capabilities using pg_trgm

-- 1. Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Create GIN index for faster similarity searches
CREATE INDEX IF NOT EXISTS idx_dim_customer_name_trgm ON dw.dim_customer USING gin (customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_dim_product_name_trgm ON dw.dim_product USING gin (item_name gin_trgm_ops);

-- 3. Function to get suggested customer matches
-- Returns groups where one item is the 'potential master' and others are similar
CREATE OR REPLACE FUNCTION public.get_customer_match_suggestions(p_threshold float DEFAULT 0.4, p_limit int DEFAULT 20)
RETURNS TABLE (
    master_id text,
    master_name text,
    suggestions jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH unmatched AS (
        SELECT customer_id, customer_name 
        FROM dw.dim_customer 
        WHERE master_customer_id IS NULL 
        AND archived IS DISTINCT FROM true
    ),
    pairs AS (
        SELECT 
            u1.customer_id as m_id,
            u1.customer_name as m_name,
            u2.customer_id as c_id,
            u2.customer_name as c_name,
            similarity(u1.customer_name, u2.customer_name) as sim_score
        FROM unmatched u1
        JOIN unmatched u2 ON u1.customer_id < u2.customer_id -- Ensure distinct pairs, avoid self-match
        WHERE similarity(u1.customer_name, u2.customer_name) > p_threshold
    ),
    -- We want to group these. A simple pair list might duplicate groups (A-B, A-C).
    -- Grouping by u1 is a good start.
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

-- 4. Function to get suggested product matches (Same logic)
CREATE OR REPLACE FUNCTION public.get_product_match_suggestions(p_threshold float DEFAULT 0.4, p_limit int DEFAULT 20)
RETURNS TABLE (
    master_id bigint,
    master_name text,
    suggestions jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH unmatched AS (
        SELECT product_id, item_name, product_code
        FROM dw.dim_product 
        WHERE master_product_id IS NULL 
        AND archived IS DISTINCT FROM true
    ),
    pairs AS (
        SELECT 
            u1.product_id as m_id,
            u1.item_name as m_name,
            u2.product_id as c_id,
            u2.item_name as c_name,
            u2.product_code as c_code,
            similarity(u1.item_name, u2.item_name) as sim_score
        FROM unmatched u1
        JOIN unmatched u2 ON u1.product_id < u2.product_id
        WHERE similarity(u1.item_name, u2.item_name) > p_threshold
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

GRANT EXECUTE ON FUNCTION public.get_customer_match_suggestions TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_match_suggestions TO authenticated;
