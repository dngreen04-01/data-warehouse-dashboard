-- View to provide the necessary data for generating customer statements.
-- Only shows unpaid invoices (status != 'PAID' and amount_due > 0)

create or replace view mart.vw_statement_details as
select
    c.merchant_group,
    c.customer_name,
    c.bill_to,
    i.invoice_number,
    i.invoice_date,
    (i.invoice_date + interval '30 day')::date as due_date,
    i.net_amount as original_amount,
    i.amount_due as outstanding_amount,
    i.status as invoice_status,
    case
        when (current_date - (i.invoice_date + interval '30 day')::date) <= 0 then 'current'
        when (current_date - (i.invoice_date + interval '30 day')::date) between 1 and 30 then '1-30'
        when (current_date - (i.invoice_date + interval '30 day')::date) between 31 and 60 then '31-60'
        when (current_date - (i.invoice_date + interval '30 day')::date) between 61 and 90 then '61-90'
        else '90+'
    end as aging_bucket
from dw.fct_invoice as i
join dw.dim_customer as c on i.customer_id = c.customer_id
where
    i.status != 'PAID'
    and i.amount_due > 0;
