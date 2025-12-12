-- Migration: Statement Filtering Logic & Public Wrapper
-- Date: 2025-12-12
-- Description: Updates the statement view in 'mart' schema with strict filtering.
--              Re-creates 'public' view wrapper for frontend compatibility.

-- 1. Update the core logic in MART schema
DROP VIEW IF EXISTS mart.vw_statement_details CASCADE;

CREATE VIEW mart.vw_statement_details AS
SELECT
    c.merchant_group,
    c.customer_name,
    c.bill_to,
    i.invoice_number,
    i.invoice_date,
    (i.invoice_date + interval '30 days')::date as due_date,
    i.amount_due as outstanding_amount,
    i.status as invoice_status,
    CASE
        WHEN (current_date - i.invoice_date) <= 30 THEN 'current'
        WHEN (current_date - i.invoice_date) <= 60 THEN '1-30'
        WHEN (current_date - i.invoice_date) <= 90 THEN '31-60'
        WHEN (current_date - i.invoice_date) <= 120 THEN '61-90'
        ELSE '90+'
    END as aging_bucket
FROM dw.fct_invoice i
JOIN dw.dim_customer c ON i.customer_id = c.customer_id
WHERE
    -- 1. Status Filter: Only AUTHORISED and Unpaid
    i.status = 'AUTHORISED'
    AND i.amount_due > 0

    -- 2. Merchant Filter: Specific groups only
    -- Using ILIKE for robustness
    AND (
        c.merchant_group ILIKE '%Farmlands%'
        OR c.merchant_group ILIKE '%Wrightson%'
        OR c.merchant_group ILIKE '%HortiCentre%'
    )

    -- 3. Date Filter: Prior to the start of the current month
    AND i.invoice_date < DATE_TRUNC('month', CURRENT_DATE)

    -- Keep existing safeguards
    AND (i.document_type IN ('ACCREC', 'Tax Invoice') OR i.document_type IS NULL)
    AND (c.archived = false OR c.archived IS NULL)
    AND (c.customer_type != 'supplier' OR c.customer_type IS NULL);

COMMENT ON VIEW mart.vw_statement_details IS
'Outstanding authorised sales invoices for key merchant groups (Farmlands, Wrightson, HortiCentre).
Strictly filters for invoices prior to the current month for statement generation.';

GRANT SELECT ON mart.vw_statement_details TO authenticated;
GRANT SELECT ON mart.vw_statement_details TO service_role;


-- 2. Create PUBLIC wrapper for frontend access
-- The frontend currently queries 'vw_statement_details' without specifying schema (defaults to public)
DROP VIEW IF EXISTS public.vw_statement_details CASCADE;

CREATE VIEW public.vw_statement_details AS
SELECT * FROM mart.vw_statement_details;

COMMENT ON VIEW public.vw_statement_details IS
'Public wrapper for mart.vw_statement_details to support frontend access.';

GRANT SELECT ON public.vw_statement_details TO authenticated;
GRANT SELECT ON public.vw_statement_details TO service_role;