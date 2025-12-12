-- Migration: React Support (Views & RPCs)
-- Description: Adds views for statements and RPC functions for dashboard analytics
-- Date: 2025-12-11

-- 1. Create missing view for Statement Generation
drop view if exists mart.vw_statement_details cascade;
drop view if exists public.vw_statement_details cascade;

create or replace view mart.vw_statement_details as
select
    c.merchant_group,
    c.customer_name,
    c.bill_to,
    i.invoice_number,
    i.invoice_date,
    -- Assuming due_date is 30 days after invoice_date if not present (adjust logic as needed)
    (i.invoice_date + interval '30 days')::date as due_date,
    i.amount_due as outstanding_amount,
    case
        when (current_date - i.invoice_date) <= 0 then 'current' -- Should not happen for overdue but for safety
        when (current_date - i.invoice_date) <= 30 then 'current'
        when (current_date - i.invoice_date) <= 60 then '1-30'
        when (current_date - i.invoice_date) <= 90 then '31-60'
        when (current_date - i.invoice_date) <= 120 then '61-90'
        else '90+'
    end as aging_bucket
from dw.fct_invoice i
join dw.dim_customer c on i.customer_id = c.customer_id
where i.status not in ('VOIDED', 'DELETED', 'PAID')
  and i.amount_due > 0
  and i.document_type != 'ACCPAY';

-- RPCs moved to 20251211_dashboard_v2.sql to avoid conflicts
