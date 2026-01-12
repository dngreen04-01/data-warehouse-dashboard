-- Migration: Merchant Group Addresses
-- Date: 2026-01-14
-- Description: Store merchant group bill-to addresses and use them in statements.

CREATE TABLE IF NOT EXISTS dw.dim_merchant_group (
    merchant_group text PRIMARY KEY,
    bill_to text,
    created_at timestamptz DEFAULT timezone('utc', now()),
    updated_at timestamptz DEFAULT timezone('utc', now())
);

-- Merchant group list for the Customers UI
CREATE OR REPLACE FUNCTION public.get_merchant_groups()
RETURNS TABLE (
    merchant_group text,
    bill_to text,
    customer_count int
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.merchant_group,
        mg.bill_to,
        COUNT(*)::int as customer_count
    FROM dw.dim_customer c
    LEFT JOIN dw.dim_merchant_group mg
        ON mg.merchant_group = c.merchant_group
    WHERE c.merchant_group IS NOT NULL AND c.merchant_group != ''
    GROUP BY c.merchant_group, mg.bill_to
    ORDER BY c.merchant_group;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_merchant_groups() TO authenticated;

-- Upsert merchant group address
CREATE OR REPLACE FUNCTION public.upsert_merchant_group(
    p_merchant_group text,
    p_bill_to text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO dw.dim_merchant_group (merchant_group, bill_to)
    VALUES (p_merchant_group, NULLIF(p_bill_to, ''))
    ON CONFLICT (merchant_group) DO UPDATE
    SET
        bill_to = EXCLUDED.bill_to,
        updated_at = timezone('utc', now());
END;
$$;
GRANT EXECUTE ON FUNCTION public.upsert_merchant_group(text, text) TO authenticated;

-- Update statement details to use merchant group bill-to address when present.
DROP VIEW IF EXISTS mart.vw_statement_details CASCADE;

CREATE VIEW mart.vw_statement_details AS
SELECT
    COALESCE(master.merchant_group, c.merchant_group) as merchant_group,
    c.customer_name,
    c.bill_to,
    COALESCE(mg.bill_to, master.bill_to) as head_office_address,
    i.invoice_number,
    i.invoice_date,
    (i.invoice_date + interval '30 days')::date as due_date,
    i.amount_due as outstanding_amount,
    i.status as invoice_status,
    CASE
        WHEN (current_date - (i.invoice_date + interval '30 days')::date) <= 0 THEN 'current'
        WHEN (current_date - (i.invoice_date + interval '30 days')::date) BETWEEN 1 AND 30 THEN '1-30'
        WHEN (current_date - (i.invoice_date + interval '30 days')::date) BETWEEN 31 AND 60 THEN '31-60'
        WHEN (current_date - (i.invoice_date + interval '30 days')::date) BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
    END as aging_bucket
FROM dw.fct_invoice i
JOIN dw.dim_customer c ON i.customer_id = c.customer_id
LEFT JOIN dw.dim_customer master ON c.master_customer_id = master.customer_id
LEFT JOIN dw.dim_merchant_group mg
    ON mg.merchant_group = COALESCE(master.merchant_group, c.merchant_group)
WHERE
    -- 1. Status Filter: Only AUTHORISED and Unpaid
    i.status = 'AUTHORISED'
    AND i.amount_due > 0

    -- 2. Merchant Filter: Specific groups only
    AND (
        c.customer_name ILIKE '%Farmlands%'
        OR c.customer_name ILIKE '%Wrightson%'
        OR c.customer_name ILIKE '%HortiCentre%'
        OR c.customer_name ILIKE '%Horticentre%'
    )

    -- 3. Date Filter: Due by end of the statement month
    AND (i.invoice_date + interval '30 days')::date <= (
        date_trunc('month', current_date) + interval '1 month' - interval '1 day'
    )::date

    -- Keep existing safeguards
    AND (i.document_type IN ('ACCREC', 'Tax Invoice') OR i.document_type IS NULL)
    AND (c.archived = false OR c.archived IS NULL OR c.master_customer_id IS NOT NULL)
    AND (c.customer_type != 'supplier' OR c.customer_type IS NULL);

COMMENT ON VIEW mart.vw_statement_details IS
'Outstanding authorised sales invoices for key merchants (Farmlands, Wrightson, HortiCentre).
Uses master customer merchant_group for consolidation (enables grouped statements to head office).
Uses merchant group bill-to address when configured, otherwise falls back to master customer address.
Only includes invoices due by the end of the current month for statement generation.';

GRANT SELECT ON mart.vw_statement_details TO authenticated;
GRANT SELECT ON mart.vw_statement_details TO service_role;

-- PUBLIC wrapper for frontend access
DROP VIEW IF EXISTS public.vw_statement_details CASCADE;

CREATE VIEW public.vw_statement_details AS
SELECT * FROM mart.vw_statement_details;

COMMENT ON VIEW public.vw_statement_details IS
'Public wrapper for mart.vw_statement_details to support frontend access.';

GRANT SELECT ON public.vw_statement_details TO authenticated;
GRANT SELECT ON public.vw_statement_details TO service_role;
