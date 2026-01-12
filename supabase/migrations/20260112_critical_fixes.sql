-- Critical Database Fixes Migration
-- Date: 2026-01-12
-- Purpose: Address missing table, foreign key cascades, and performance indexes

-- ============================================================================
-- 1. Create Missing dim_product_group_exclusions Table
-- ============================================================================
-- This table was referenced in product_cluster_filter.sql but never created
-- Used to exclude non-revenue product groups from dashboard calculations

CREATE TABLE IF NOT EXISTS dw.dim_product_group_exclusions (
    product_group TEXT PRIMARY KEY,
    reason TEXT,
    excluded_at TIMESTAMPTZ DEFAULT timezone('utc', now()),
    excluded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_group_exclusions
    ON dw.dim_product_group_exclusions(product_group);

COMMENT ON TABLE dw.dim_product_group_exclusions IS 'Product groups excluded from revenue calculations (e.g., internal transfers, samples)';

-- ============================================================================
-- 2. Add Foreign Key Cascade Behavior
-- ============================================================================
-- Problem: Deleting/archiving customers leaves orphaned invoices and sales lines
-- Solution: Use SET NULL to preserve historical data but clear the reference

-- 2a. Fix fct_invoice.customer_id foreign key
ALTER TABLE dw.fct_invoice
    DROP CONSTRAINT IF EXISTS fct_invoice_customer_id_fkey;

ALTER TABLE dw.fct_invoice
    ADD CONSTRAINT fct_invoice_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES dw.dim_customer(customer_id)
    ON DELETE SET NULL;

-- 2b. Fix fct_sales_line.customer_id foreign key
ALTER TABLE dw.fct_sales_line
    DROP CONSTRAINT IF EXISTS fct_sales_line_customer_id_fkey;

ALTER TABLE dw.fct_sales_line
    ADD CONSTRAINT fct_sales_line_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES dw.dim_customer(customer_id)
    ON DELETE SET NULL;

-- 2c. Fix crm.interaction_items.customer_id foreign key
-- Use SET NULL to preserve CRM history even if customer is deleted
ALTER TABLE crm.interaction_items
    DROP CONSTRAINT IF EXISTS interaction_items_customer_id_fkey;

ALTER TABLE crm.interaction_items
    ADD CONSTRAINT interaction_items_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES dw.dim_customer(customer_id)
    ON DELETE SET NULL;

-- ============================================================================
-- 3. Add Performance Indexes
-- ============================================================================
-- Composite index for common date+customer queries
CREATE INDEX IF NOT EXISTS idx_fct_sales_line_customer_date
    ON dw.fct_sales_line(customer_id, invoice_date);

-- Index on invoice status (heavily filtered in views)
CREATE INDEX IF NOT EXISTS idx_fct_invoice_status
    ON dw.fct_invoice(status);

-- Partial indexes for dimension table lookups (used in dropdown filters)
CREATE INDEX IF NOT EXISTS idx_dim_customer_market
    ON dw.dim_customer(market)
    WHERE market IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dim_customer_merchant_group
    ON dw.dim_customer(merchant_group)
    WHERE merchant_group IS NOT NULL;

-- Index on archived flag (used in many queries)
CREATE INDEX IF NOT EXISTS idx_dim_customer_archived
    ON dw.dim_customer(archived)
    WHERE archived = false OR archived IS NULL;

-- Index for product group lookups
CREATE INDEX IF NOT EXISTS idx_dim_product_product_group
    ON dw.dim_product(product_group)
    WHERE product_group IS NOT NULL;

-- ============================================================================
-- 4. Grant Permissions
-- ============================================================================
GRANT SELECT ON dw.dim_product_group_exclusions TO authenticated;
GRANT INSERT, UPDATE, DELETE ON dw.dim_product_group_exclusions TO service_role;

-- ============================================================================
-- 5. Add Unique Constraint to Email Subscriptions (prevent duplicates)
-- ============================================================================
-- Check if the table exists before adding constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'email_subscriptions'
    ) THEN
        -- Remove duplicates first (keep the oldest)
        DELETE FROM public.email_subscriptions a
        USING public.email_subscriptions b
        WHERE a.id > b.id
        AND a.email = b.email
        AND a.report_type = b.report_type;

        -- Add unique constraint
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'email_subscriptions_email_report_type_key'
        ) THEN
            ALTER TABLE public.email_subscriptions
            ADD CONSTRAINT email_subscriptions_email_report_type_key
            UNIQUE (email, report_type);
        END IF;
    END IF;
END$$;
