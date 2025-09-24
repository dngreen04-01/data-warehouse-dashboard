-- Analytics views powering the dashboard experience

create schema if not exists mart;

create or replace view mart.sales_enriched as
select
    sl.sales_line_id,
    sl.invoice_number,
    sl.invoice_date,
    sl.document_type,
    sl.customer_id,
    c.customer_name,
    c.market,
    c.merchant_group,
    cc.cluster_id,
    cl.cluster_label,
    sl.product_id,
    sl.product_code,
    p.item_name,
    p.product_group,
    sl.qty,
    sl.unit_price,
    sl.line_amount,
    sl.load_source,
    sl.loaded_at
from dw.fct_sales_line sl
left join dw.dim_customer c on c.customer_id = sl.customer_id
left join dw.dim_customer_cluster cc on cc.customer_id = sl.customer_id
left join dw.dim_cluster cl on cl.cluster_id = cc.cluster_id
left join dw.dim_product p on p.product_id = sl.product_id;

create or replace view mart.daily_sales as
select
    invoice_date,
    sum(line_amount) as revenue,
    sum(qty) as qty_sold,
    count(distinct invoice_number) as invoice_count,
    min(loaded_at) as first_loaded_at,
    max(loaded_at) as last_loaded_at
from dw.fct_sales_line
group by invoice_date;

create or replace view mart.sales_by_dimension as
select
    invoice_date,
    customer_id,
    product_id,
    product_code,
    coalesce(cluster_id, -1) as cluster_id,
    coalesce(market, 'Unknown') as market,
    coalesce(merchant_group, 'Unknown') as merchant_group,
    sum(line_amount) as revenue,
    sum(qty) as qty_sold
from mart.sales_enriched
group by 1,2,3,4,5,6,7;

create or replace view mart.kpi_period_comparison as
with base as (
    select
        invoice_date,
        date_part('year', invoice_date)::int as cal_year,
        date_part('month', invoice_date)::int as cal_month,
        date_part('week', invoice_date)::int as cal_week,
        sum(line_amount) as revenue,
        sum(qty) as qty_sold
    from dw.fct_sales_line
    group by 1
)
select
    b.invoice_date,
    b.cal_year,
    b.cal_month,
    b.cal_week,
    b.revenue,
    b.qty_sold,
    sum(b.revenue) over (partition by b.cal_year order by b.invoice_date) as revenue_ytd,
    sum(b.qty_sold) over (partition by b.cal_year order by b.invoice_date) as qty_ytd,
    sum(b.revenue) over (partition by b.cal_year, b.cal_month order by b.invoice_date) as revenue_mtd,
    sum(b.revenue) over (partition by b.cal_year, b.cal_week order by b.invoice_date) as revenue_wtd
from base b;

create or replace view mart.data_freshness as
select
    pipeline_name,
    status,
    max(started_at) as last_run_started_at,
    max(finished_at) filter (where status = 'success') as last_success_at,
    max(processed_rows) filter (where status = 'success') as last_rows_processed
from dw.etl_run_log
group by pipeline_name, status;
