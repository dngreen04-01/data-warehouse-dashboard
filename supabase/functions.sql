-- Utility functions & triggers for operational management

create or replace function dw.set_updated_at()
returns trigger as
$$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$ language plpgsql;

create trigger dim_customer_updated_at
    before update on dw.dim_customer
    for each row
    execute function dw.set_updated_at();

create trigger dim_product_updated_at
    before update on dw.dim_product
    for each row
    execute function dw.set_updated_at();

create or replace function dw.log_etl_run(
    p_pipeline_name text,
    p_status text,
    p_processed_rows integer default null,
    p_error_message text default null
) returns uuid as
$$
declare
    v_run_id uuid := gen_random_uuid();
begin
    insert into dw.etl_run_log(run_id, pipeline_name, status, processed_rows, error_message)
    values (v_run_id, p_pipeline_name, p_status, p_processed_rows, p_error_message);
    return v_run_id;
end;
$$ language plpgsql;
