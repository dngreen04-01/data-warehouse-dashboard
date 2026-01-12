-- Migration: Statement Due Date Filtering
-- Date: 2026-01-13
-- Description: Update statement view to include invoices due by month-end and age by due date.

-- 1. Update the core logic in MART schema
DROP VIEW IF EXISTS mart.vw_statement_details CASCADE;

CREATE VIEW mart.vw_statement_details AS
SELECT
    COALESCE(master.merchant_group, c.merchant_group) as merchant_group,
    c.customer_name,
    c.bill_to,
    master.bill_to as head_office_address,
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
Includes head_office_address from master customer for billing purposes.
Only includes invoices due by the end of the current month for statement generation.';

GRANT SELECT ON mart.vw_statement_details TO authenticated;
GRANT SELECT ON mart.vw_statement_details TO service_role;


-- 2. Create PUBLIC wrapper for frontend access
DROP VIEW IF EXISTS public.vw_statement_details CASCADE;

CREATE VIEW public.vw_statement_details AS
SELECT * FROM mart.vw_statement_details;

COMMENT ON VIEW public.vw_statement_details IS
'Public wrapper for mart.vw_statement_details to support frontend access.';

GRANT SELECT ON public.vw_statement_details TO authenticated;
GRANT SELECT ON public.vw_statement_details TO service_role;
