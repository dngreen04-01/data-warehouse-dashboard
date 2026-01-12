-- View to provide the necessary data for generating customer statements.
-- Only shows invoices due by the end of the current month.

create or replace view mart.vw_statement_details as
select
    coalesce(master.merchant_group, c.merchant_group) as merchant_group,
    c.customer_name,
    c.bill_to,
    coalesce(mg.bill_to, master.bill_to) as head_office_address,
    i.invoice_number,
    i.invoice_date,
    (i.invoice_date + interval '30 days')::date as due_date,
    i.amount_due as outstanding_amount,
    i.status as invoice_status,
    case
        when (current_date - (i.invoice_date + interval '30 days')::date) <= 0 then 'current'
        when (current_date - (i.invoice_date + interval '30 days')::date) between 1 and 30 then '1-30'
        when (current_date - (i.invoice_date + interval '30 days')::date) between 31 and 60 then '31-60'
        when (current_date - (i.invoice_date + interval '30 days')::date) between 61 and 90 then '61-90'
        else '90+'
    end as aging_bucket
from dw.fct_invoice as i
join dw.dim_customer as c on i.customer_id = c.customer_id
left join dw.dim_customer as master on c.master_customer_id = master.customer_id
left join dw.dim_merchant_group as mg
    on mg.merchant_group = coalesce(master.merchant_group, c.merchant_group)
where
    i.status = 'AUTHORISED'
    and i.amount_due > 0
    and (
        c.customer_name ilike '%Farmlands%'
        or c.customer_name ilike '%Wrightson%'
        or c.customer_name ilike '%HortiCentre%'
        or c.customer_name ilike '%Horticentre%'
    )
    and (i.invoice_date + interval '30 days')::date <= (
        date_trunc('month', current_date) + interval '1 month' - interval '1 day'
    )::date
    and (i.document_type in ('ACCREC', 'Tax Invoice') or i.document_type is null)
    and (c.archived = false or c.archived is null or c.master_customer_id is not null)
    and (c.customer_type != 'supplier' or c.customer_type is null);
