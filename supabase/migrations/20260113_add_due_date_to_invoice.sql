-- Migration: Add actual due_date to fct_invoice
-- Date: 2026-01-13
-- Description: Store actual Xero due date instead of calculating invoice_date + 30 days.
--              Updates statement view to use actual due date for aging buckets.

-- 1. Add due_date column to fct_invoice
ALTER TABLE dw.fct_invoice
ADD COLUMN IF NOT EXISTS due_date date;

-- Set default for existing rows (invoice_date + 30 days as fallback)
UPDATE dw.fct_invoice
SET due_date = invoice_date + interval '30 days'
WHERE due_date IS NULL;

COMMENT ON COLUMN dw.fct_invoice.due_date IS 'Payment due date from Xero. Falls back to invoice_date + 30 days if not available.';


-- 2. Update the MART statement view to use actual due_date
DROP VIEW IF EXISTS mart.vw_statement_details CASCADE;

CREATE VIEW mart.vw_statement_details AS
SELECT
    COALESCE(master.merchant_group, c.merchant_group) as merchant_group,
    c.customer_name,
    c.bill_to,
    COALESCE(mg.bill_to, master.bill_to) as head_office_address,
    i.invoice_number,
    i.invoice_date,
    COALESCE(i.due_date, (i.invoice_date + interval '30 days')::date) as due_date,
    i.amount_due as outstanding_amount,
    i.status as invoice_status,
    -- Aging based on days past due date (negative = not yet due)
    CASE
        WHEN current_date <= COALESCE(i.due_date, (i.invoice_date + interval '30 days')::date) THEN 'current'
        WHEN (current_date - COALESCE(i.due_date, (i.invoice_date + interval '30 days')::date)) BETWEEN 1 AND 30 THEN '1-30'
        WHEN (current_date - COALESCE(i.due_date, (i.invoice_date + interval '30 days')::date)) BETWEEN 31 AND 60 THEN '31-60'
        WHEN (current_date - COALESCE(i.due_date, (i.invoice_date + interval '30 days')::date)) BETWEEN 61 AND 90 THEN '61-90'
        ELSE '90+'
    END as aging_bucket
FROM dw.fct_invoice i
JOIN dw.dim_customer c ON i.customer_id = c.customer_id
LEFT JOIN dw.dim_customer master ON c.master_customer_id = master.customer_id
LEFT JOIN dw.dim_merchant_group mg
    ON mg.merchant_group = COALESCE(master.merchant_group, c.merchant_group)
WHERE
    i.status = 'AUTHORISED'
    AND i.amount_due > 0
    AND (
        c.customer_name ILIKE '%Farmlands%'
        OR c.customer_name ILIKE '%Wrightson%'
        OR c.customer_name ILIKE '%HortiCentre%'
        OR c.customer_name ILIKE '%Horticentre%'
    )
    -- Include invoices due by end of current month
    AND COALESCE(i.due_date, (i.invoice_date + interval '30 days')::date) <= (
        date_trunc('month', current_date) + interval '1 month' - interval '1 day'
    )::date
    AND (i.document_type IN ('ACCREC', 'Tax Invoice') OR i.document_type IS NULL)
    AND (c.archived = false OR c.archived IS NULL OR c.master_customer_id IS NOT NULL)
    AND (c.customer_type != 'supplier' OR c.customer_type IS NULL);

COMMENT ON VIEW mart.vw_statement_details IS
'Outstanding authorised sales invoices for key merchants (Farmlands, Wrightson, HortiCentre).
Aging is calculated based on actual due_date from Xero (falls back to invoice_date + 30 days).
Current = not yet past due. 1-30/31-60/61-90/90+ = days past the due date.';

GRANT SELECT ON mart.vw_statement_details TO authenticated;
GRANT SELECT ON mart.vw_statement_details TO service_role;


-- 3. Recreate PUBLIC wrapper for frontend access
DROP VIEW IF EXISTS public.vw_statement_details CASCADE;

CREATE VIEW public.vw_statement_details AS
SELECT * FROM mart.vw_statement_details;

COMMENT ON VIEW public.vw_statement_details IS
'Public wrapper for mart.vw_statement_details to support frontend access.';

GRANT SELECT ON public.vw_statement_details TO authenticated;
GRANT SELECT ON public.vw_statement_details TO service_role;
