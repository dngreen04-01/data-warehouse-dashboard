-- Add archiving support to interactions
alter table crm.interactions 
add column if not exists archived boolean default false;

-- Create Tasks table
create table if not exists crm.tasks (
    task_id uuid primary key default gen_random_uuid(),
    created_at timestamptz default timezone('utc', now()),
    description text not null,
    due_date timestamptz,
    is_complete boolean default false,
    source_item_id uuid references crm.interaction_items(item_id) on delete set null,
    assigned_to text -- Optional, for future use
);

-- Indexes
create index if not exists idx_tasks_due_date on crm.tasks(due_date);
create index if not exists idx_tasks_is_complete on crm.tasks(is_complete);

-- Grant permissions (important for API access)
grant all on table crm.tasks to postgres, authenticated, service_role;
grant select, update, insert, delete on table crm.interactions to authenticated, service_role;
