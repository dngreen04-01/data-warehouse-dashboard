-- Create email_subscriptions table for Weekly Sales Report

create table if not exists dw.email_subscriptions (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    report_type text check (report_type in ('short', 'detailed')),
    frequency text default 'weekly',
    is_active boolean default true,
    created_at timestamptz default timezone('utc', now()),
    updated_at timestamptz default timezone('utc', now())
);

-- Add unique constraint to prevent duplicate subscriptions for the same email and report type?
-- Or just one subscription per email?
-- Requirement says "allow me to set up who is receiving what email".
-- A user might want both? Unlikely. Let's assume one main subscription per email for now, or allow multiple.
-- Let's add a unique constraint on email to keep it simple for now, or strictly: 
-- If they want both, they might need two entries? No, let's keep it simple: one active subscription per email.
-- Actually the requirement implies different people get different things.
-- Let's just index email.

create index if not exists idx_email_subscriptions_email on dw.email_subscriptions(email);

-- RLS policies (if applicable, but dw schema might not be exposed to RLS directly same as public)
-- Assuming this is a backend table, but frontend needs to access it.
-- If frontend accesses via Supabase client, we might need to expose it in `public` schema OR
-- create a view in `public` or grant permissions.
-- The existing tables seem to be in `dw`.
-- Let's check permissions.sql or similar if we need to grant access.
-- For now, I will create it in `dw` as per plan.

-- Grant access to authenticated users (if needed for the frontend management)
-- grant select, insert, update, delete on dw.email_subscriptions to authenticated;
-- But usually `dw` is not exposed.
-- Wait, the `App` uses Supabase client.
-- Supabase client usually talks to `public` schema.
-- `mart` and `dw` are often backend schemas.
-- `weekly_email.py` accesses `mart`.
-- If the frontend needs to manage this, we should arguably put it in `public` or expose a view?
-- However, the user said "In the back-end of the application, allow me to set up...".
-- And I see `supabase/migrations/20251211_react_support.sql` which might have exposed things.
-- Let's stick to `dw` for the "data warehouse" feel, BUT for a configuration table accessed by the app, `public` is standard Supabase.
-- OR I can create a wrapper function.
-- Let's put it in `dw` to be consistent with the plan, but I might need to move it or expose it later.
-- Actually, taking a look at other tables, `dw` seems to be the place.

comment on table dw.email_subscriptions is 'Configuration for Weekly Sales Report recipients';
