-- Cluster Management & Advanced Analytics
-- Date: 2025-12-11

-- 1. Create Product Cluster Table (Missing)
create table if not exists dw.dim_product_cluster (
    product_id int references dw.dim_product(product_id),
    cluster_id int references dw.dim_cluster(cluster_id),
    created_at timestamptz default timezone('utc', now()),
    primary key (product_id, cluster_id)
);

grant select, insert, delete on dw.dim_product_cluster to authenticated;

-- 2. Cluster Management RPCs

-- Create Cluster
create or replace function public.create_cluster(
    p_label text
)
returns int
language plpgsql
security definer
as $$
declare
    v_id int;
begin
    insert into dw.dim_cluster (cluster_label)
    values (p_label)
    returning cluster_id into v_id;
    return v_id;
end;
$$;
grant execute on function public.create_cluster to authenticated;

-- Rename Cluster
create or replace function public.rename_cluster(
    p_cluster_id int,
    p_new_label text
)
returns void
language plpgsql
security definer
as $$
begin
    update dw.dim_cluster
    set cluster_label = p_new_label, updated_at = timezone('utc', now())
    where cluster_id = p_cluster_id;
end;
$$;
grant execute on function public.rename_cluster to authenticated;

-- Delete Cluster (Optional, handle contents)
create or replace function public.delete_cluster(
    p_cluster_id int
)
returns void
language plpgsql
security definer
as $$
begin
    delete from dw.dim_customer_cluster where cluster_id = p_cluster_id;
    delete from dw.dim_product_cluster where cluster_id = p_cluster_id;
    delete from dw.dim_cluster where cluster_id = p_cluster_id;
end;
$$;
grant execute on function public.delete_cluster to authenticated;

-- Add/Remove Customer
create or replace function public.manage_cluster_member(
    p_type text, -- 'customer' or 'product'
    p_action text, -- 'add' or 'remove'
    p_cluster_id int,
    p_entity_id text
)
returns void
language plpgsql
security definer
as $$
begin
    if p_type = 'customer' then
        if p_action = 'add' then
            insert into dw.dim_customer_cluster (customer_id, cluster_id)
            values (p_entity_id, p_cluster_id)
            on conflict (customer_id, cluster_id) do nothing;
        else
            delete from dw.dim_customer_cluster
            where customer_id = p_entity_id and cluster_id = p_cluster_id;
        end if;
    elsif p_type = 'product' then
        if p_action = 'add' then
            insert into dw.dim_product_cluster (product_id, cluster_id)
            values (p_entity_id::int, p_cluster_id)
            on conflict (product_id, cluster_id) do nothing;
        else
            delete from dw.dim_product_cluster
            where product_id = p_entity_id::int and cluster_id = p_cluster_id;
        end if;
    end if;
end;
$$;
grant execute on function public.manage_cluster_member to authenticated;

-- Get Cluster Members
create or replace function public.get_cluster_members(
    p_cluster_id int,
    p_type text
)
returns table (
    id text,
    name text
)
language plpgsql
security definer
as $$
begin
    if p_type = 'customer' then
        return query
        select c.customer_id, c.customer_name
        from dw.dim_customer_cluster cc
        join dw.dim_customer c on c.customer_id = cc.customer_id
        where cc.cluster_id = p_cluster_id;
    else
        return query
        select p.product_id, p.item_name
        from dw.dim_product_cluster pc
        join dw.dim_product p on p.product_id = pc.product_id
        where pc.cluster_id = p_cluster_id;
    end if;
end;
$$;
grant execute on function public.get_cluster_members to authenticated;


-- 3. Analytics: Key Movers
-- Find top entities that increased/decreased the most in absolute revenue vs previous period
create or replace function public.get_key_movers(
    p_dimension text, -- 'product', 'customer', 'market'
    p_start_date date,
    p_end_date date,
    p_limit int default 5
)
returns table (
    label text,
    current_revenue numeric,
    previous_revenue numeric,
    delta numeric,
    pct_change numeric
)
language plpgsql
security definer
as $$
declare
    v_prev_start date := p_start_date - interval '1 year';
    v_prev_end date := p_end_date - interval '1 year';
    v_col text;
begin
    v_col := case 
        when p_dimension = 'product' then 'item_name'
        when p_dimension = 'customer' then 'customer_name'
        when p_dimension = 'market' then 'market'
        else 'item_name'
    end;

    return query
    execute format('
        with current_period as (
            select %I as label, sum(line_amount) as revenue
            from mart.sales_enriched
            where invoice_date between $1 and $2
            group by 1
        ),
        previous_period as (
            select %I as label, sum(line_amount) as revenue
            from mart.sales_enriched
            where invoice_date between $3 and $4
            group by 1
        )
        select
            coalesce(c.label, p.label)::text as label,
            coalesce(c.revenue, 0) as current_revenue,
            coalesce(p.revenue, 0) as previous_revenue,
            (coalesce(c.revenue, 0) - coalesce(p.revenue, 0)) as delta,
            case when coalesce(p.revenue, 0) = 0 then 100 else
                round(((coalesce(c.revenue, 0) - p.revenue) / p.revenue * 100), 1)
            end as pct_change
        from current_period c
        full outer join previous_period p on c.label = p.label
        order by abs(coalesce(c.revenue, 0) - coalesce(p.revenue, 0)) desc
        limit $5
    ', v_col, v_col)
    using p_start_date, p_end_date, v_prev_start, v_prev_end, p_limit;
end;
$$;
grant execute on function public.get_key_movers to authenticated;
