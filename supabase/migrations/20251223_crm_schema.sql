-- CRM Schema for storing sales interactions

create schema if not exists crm;

-- Interactions Table: High-level record of the communication (e.g., the email reply)
create table if not exists crm.interactions (
    interaction_id uuid primary key default gen_random_uuid(),
    created_at timestamptz default timezone('utc', now()),
    author_email text,
    source text default 'email_reply', -- 'email_reply', 'manual_entry', etc.
    original_text text,
    summary text,
    sentiment_score numeric(4,3) -- -1.0 to 1.0 inferred by AI
);

-- Interaction Items: Specific details extracted from the interaction
create table if not exists crm.interaction_items (
    item_id uuid primary key default gen_random_uuid(),
    interaction_id uuid references crm.interactions(interaction_id) on delete cascade,
    customer_id text references dw.dim_customer(customer_id), -- Can be null if unknown/new
    customer_name_raw text, -- The name as it appeared in the text
    product_mention text,
    activity_type text, -- 'Meeting', 'Call', 'Email', 'Order', 'Visit', 'Insight'
    notes text,
    sentiment text, -- 'Positive', 'Negative', 'Neutral'
    action_required boolean default false,
    created_at timestamptz default timezone('utc', now())
);

-- Indexes for performance
create index if not exists idx_interaction_items_customer_id on crm.interaction_items(customer_id);
create index if not exists idx_interactions_created_at on crm.interactions(created_at);
