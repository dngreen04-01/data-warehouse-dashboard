-- Dashboard V2 Support
-- Date: 2025-12-11

-- 1. Create Budget Fact Table
create table if not exists dw.fct_budget (
    budget_id text primary key, -- Composite key or Xero ID if available
    budget_name text not null,
    month_date date not null, -- First day of the month
    account_code text, -- If budgeting by GL account
    tracking_category text, -- If budgeting by tracking category (e.g., Branch/Region)
    tracking_option text,
    amount numeric(18,2) default 0,
    created_at timestamptz default timezone('utc', now()),
    updated_at timestamptz default timezone('utc', now())
);

-- Grant access
grant select on dw.fct_budget to authenticated;

-- 2. Update get_sales_overview to support more filters
drop function if exists public.get_sales_overview(date, date, text[], text[]); -- Drop V1
drop function if exists public.get_sales_overview(date, date, text[], text[], text[], text[]); -- Drop V2
create or replace function public.get_sales_overview(
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] default null,
    p_product_group text[] default null,
    p_market text[] default null,
    p_cluster text[] default null
)
returns table (
    invoice_date date,
    revenue numeric,
    quantity numeric
)
language plpgsql
security definer
as $$
begin
    return query
    select
        s.invoice_date,
        sum(s.line_amount) as revenue,
        sum(s.qty) as quantity
    from mart.sales_enriched s
    where s.invoice_date between p_start_date and p_end_date
      and (p_merchant_group is null or s.merchant_group = any(p_merchant_group))
      and (p_product_group is null or s.product_group = any(p_product_group))
      and (p_market is null or s.market = any(p_market))
      and (p_cluster is null or s.cluster_label = any(p_cluster))
    group by s.invoice_date
    order by s.invoice_date;
end;
$$;

grant execute on function public.get_sales_overview to authenticated;

-- 3. Update get_breakdown to support more filters
drop function if exists public.get_breakdown(text, date, date, text[], text[], int); -- Drop V1
drop function if exists public.get_breakdown(text, date, date, text[], text[], text[], text[], int); -- Drop V2
create or replace function public.get_breakdown(
    p_dimension text,
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] default null,
    p_product_group text[] default null,
    p_market text[] default null,
    p_cluster text[] default null,
    p_limit int default 10
)
returns table (
    label text,
    revenue numeric,
    quantity numeric
)
language plpgsql
security definer
as $$
begin
    return query
    execute format('
        select
            coalesce(%I, ''Unknown'')::text as label,
            sum(line_amount) as revenue,
            sum(qty) as quantity
        from mart.sales_enriched
        where invoice_date between $1 and $2
          and ($3 is null or merchant_group = any($3))
          and ($4 is null or product_group = any($4))
          and ($5 is null or market = any($5))
          and ($6 is null or cluster_label = any($6))
        group by 1
        order by revenue desc
        limit $7
    ', case 
        when p_dimension = 'product' then 'item_name'
        when p_dimension = 'customer' then 'customer_name'
        when p_dimension = 'market' then 'market'
        when p_dimension = 'merchant_group' then 'merchant_group'
        when p_dimension = 'product_group' then 'product_group'
        when p_dimension = 'cluster' then 'cluster_label'
        else 'item_name' -- default
       end)
    using p_start_date, p_end_date, p_merchant_group, p_product_group, p_market, p_cluster, p_limit;
end;
$$;

grant execute on function public.get_breakdown to authenticated;

-- 4. Year-over-Year Comparison RPC
drop function if exists public.get_yoy_comparison(date, date, text[], text[]); -- Drop V1
drop function if exists public.get_yoy_comparison(date, date, text[], text[], text[], text[]); -- Drop V2 (if exists)
create or replace function public.get_yoy_comparison(
    p_start_date date,
    p_end_date date,
    p_merchant_group text[] default null,
    p_product_group text[] default null,
    p_market text[] default null,
    p_cluster text[] default null
)
returns table (
    period text,
    current_revenue numeric,
    previous_revenue numeric,
    current_qty numeric,
    previous_qty numeric
)
language plpgsql
security definer
as $$
declare
    v_prev_start date := p_start_date - interval '1 year';
    v_prev_end date := p_end_date - interval '1 year';
    v_curr_rev numeric;
    v_curr_qty numeric;
    v_prev_rev numeric;
    v_prev_qty numeric;
begin
    -- Current Period
    select
        coalesce(sum(line_amount), 0),
        coalesce(sum(qty), 0)
    into v_curr_rev, v_curr_qty
    from mart.sales_enriched s
    where s.invoice_date between p_start_date and p_end_date
      and (p_merchant_group is null or s.merchant_group = any(p_merchant_group))
      and (p_product_group is null or s.product_group = any(p_product_group))
      and (p_market is null or s.market = any(p_market))
      and (p_cluster is null or s.cluster_label = any(p_cluster));

    -- Previous Period
    select
        coalesce(sum(line_amount), 0),
        coalesce(sum(qty), 0)
    into v_prev_rev, v_prev_qty
    from mart.sales_enriched s
    where s.invoice_date between v_prev_start and v_prev_end
      and (p_merchant_group is null or s.merchant_group = any(p_merchant_group))
      and (p_product_group is null or s.product_group = any(p_product_group))
      and (p_market is null or s.market = any(p_market))
      and (p_cluster is null or s.cluster_label = any(p_cluster));

    return query select
        'Selected Range'::text,
        v_curr_rev,
        v_prev_rev,
        v_curr_qty,
        v_prev_qty;
end;
$$;

grant execute on function public.get_yoy_comparison to authenticated;

-- 5. Budget vs Actuals RPC
drop function if exists public.get_budget_vs_actual;
create or replace function public.get_budget_vs_actual(
    p_start_date date,
    p_end_date date,
    p_budget_name text default null -- Optional filter for specific budget scenario
)
returns table (
    month_date date,
    actual_revenue numeric,
    amount numeric
)
language plpgsql
security definer
as $$
begin
    return query
    with monthly_sales as (
        select 
            date_trunc('month', invoice_date)::date as m_date,
            sum(line_amount) as revenue
        from mart.sales_enriched
        where invoice_date between p_start_date and p_end_date
        group by 1
    ),
    monthly_budget as (
        select
            month_date as m_date,
            sum(amount) as budget
        from dw.fct_budget
        where month_date between p_start_date and p_end_date
          and (p_budget_name is null or budget_name = p_budget_name)
        group by 1
    )
    select
        coalesce(s.m_date, b.m_date) as month_date,
        coalesce(s.revenue, 0) as actual_revenue,
        coalesce(b.budget, 0) as budget_amount
    from monthly_sales s
    full outer join monthly_budget b on s.m_date = b.m_date
    order by month_date;
end;
$$;

grant execute on function public.get_budget_vs_actual to authenticated;

-- 5. Helper to get Filter Options
create or replace function public.get_filter_options()
returns json
language plpgsql
security definer
as $$
declare
    v_result json;
begin
    select json_build_object(
        'markets', (select array_agg(distinct market) from dw.dim_customer where market is not null),
        'product_groups', (select array_agg(distinct product_group) from dw.dim_product where product_group is not null),
        'merchant_groups', (select array_agg(distinct merchant_group) from dw.dim_customer where merchant_group is not null),
        'clusters', (select array_agg(distinct cluster_label) from dw.dim_cluster)
    ) into v_result;
    return v_result;
end;
$$;

grant execute on function public.get_filter_options to authenticated;
