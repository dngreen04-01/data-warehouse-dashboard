-- Invoice Debug Support
-- Date: 2025-12-11
-- Purpose: Provide debug access to sales line data for revenue analysis

-- RPC to get all sales lines for debugging
CREATE OR REPLACE FUNCTION public.get_sales_lines_debug(
    p_start_date date,
    p_end_date date
)
RETURNS TABLE(
    sales_line_id bigint,
    invoice_number text,
    invoice_date date,
    document_type text,
    customer_id text,
    customer_name text,
    product_code text,
    item_name text,
    qty numeric,
    line_amount numeric,
    load_source text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        sl.sales_line_id,
        sl.invoice_number,
        sl.invoice_date,
        sl.document_type,
        sl.customer_id,
        sl.customer_name,
        sl.product_code,
        sl.item_name,
        sl.qty,
        sl.line_amount,
        sl.load_source
    FROM dw.fct_sales_line sl
    WHERE sl.invoice_date BETWEEN p_start_date AND p_end_date
    ORDER BY sl.line_amount DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_sales_lines_debug(date, date) TO anon, authenticated;

-- RPC to get summary by document type
CREATE OR REPLACE FUNCTION public.get_revenue_by_document_type(
    p_start_date date,
    p_end_date date
)
RETURNS TABLE(
    document_type text,
    line_count bigint,
    total_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(sl.document_type, 'NULL/Unknown') as document_type,
        COUNT(*)::bigint as line_count,
        SUM(sl.line_amount)::numeric as total_amount
    FROM dw.fct_sales_line sl
    WHERE sl.invoice_date BETWEEN p_start_date AND p_end_date
    GROUP BY sl.document_type
    ORDER BY total_amount DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_revenue_by_document_type(date, date) TO anon, authenticated;
