-- Queue for immediate report requests
create table if not exists dw.report_queue (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    report_type text not null,
    status text default 'pending', -- pending, processing, completed, failed
    created_at timestamptz default timezone('utc', now()),
    processed_at timestamptz,
    error_message text
);

-- RPC to queue a report
create or replace function queue_instant_report(
  p_email text,
  p_report_type text
)
returns dw.report_queue
language plpgsql
security definer
as $$
declare
  v_result dw.report_queue;
begin
  insert into dw.report_queue (email, report_type)
  values (p_email, p_report_type)
  returning * into v_result;
  return v_result;
end;
$$;
