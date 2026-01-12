-- RPCs to manage email subscriptions from the frontend

-- Get all subscriptions
create or replace function get_email_subscriptions()
returns setof dw.email_subscriptions
language sql
security definer
as $$
  select * from dw.email_subscriptions order by created_at desc;
$$;

-- Add a subscription
create or replace function add_email_subscription(
  p_email text,
  p_report_type text
)
returns dw.email_subscriptions
language plpgsql
security definer
as $$
declare
  v_result dw.email_subscriptions;
begin
  insert into dw.email_subscriptions (email, report_type)
  values (p_email, p_report_type)
  returning * into v_result;
  return v_result;
end;
$$;

-- Toggle active status
create or replace function toggle_email_subscription(
  p_id uuid,
  p_is_active boolean
)
returns dw.email_subscriptions
language plpgsql
security definer
as $$
declare
  v_result dw.email_subscriptions;
begin
  update dw.email_subscriptions
  set is_active = p_is_active, updated_at = timezone('utc', now())
  where id = p_id
  returning * into v_result;
  return v_result;
end;
$$;

-- Delete subscription
create or replace function delete_email_subscription(
  p_id uuid
)
returns void
language sql
security definer
as $$
  delete from dw.email_subscriptions where id = p_id;
$$;
