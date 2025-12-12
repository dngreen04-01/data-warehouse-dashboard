-- Migration: Schema Fixes for Missing Columns and Statement View
-- Date: 2025-12-11
-- Description: Adds missing columns to dim_customer and dim_product,
--              fixes the statement view to properly filter sales invoices

-- ============================================================================
-- PHASE 1: Add Missing Columns
-- ============================================================================

-- Add archived column to dim_customer (for soft delete functionality)
ALTER TABLE dw.dim_customer ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- Add customer_type column to dim_customer (for distinguishing customers from suppliers)
-- Values: 'customer', 'supplier', 'both'
ALTER TABLE dw.dim_customer ADD COLUMN IF NOT EXISTS customer_type text DEFAULT 'customer';

-- Add merged_into column to dim_customer (for tracking merged/duplicate customers)
ALTER TABLE dw.dim_customer ADD COLUMN IF NOT EXISTS merged_into text;

-- Add archived column to dim_product (for soft delete functionality)
ALTER TABLE dw.dim_product ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- ============================================================================
-- PHASE 2: Create Indexes for New Columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_dim_customer_archived ON dw.dim_customer(archived);
CREATE INDEX IF NOT EXISTS idx_dim_customer_type ON dw.dim_customer(customer_type);
CREATE INDEX IF NOT EXISTS idx_dim_product_archived ON dw.dim_product(archived);

-- ============================================================================
-- PHASE 3: Fix Statement View
-- ============================================================================

-- Drop existing view (CASCADE to handle any dependent views)
DROP VIEW IF EXISTS mart.vw_statement_details CASCADE;

-- Create corrected statement view that:
-- 1. Only includes sales invoices (ACCREC, not ACCPAY bills)
-- 2. Excludes archived customers
-- 3. Excludes suppliers (only show customer invoices)
-- 4. Shows proper aging buckets based on invoice age
CREATE VIEW mart.vw_statement_details AS
SELECT
    c.merchant_group,
    c.customer_name,
    c.bill_to,
    i.invoice_number,
    i.invoice_date,
    (i.invoice_date + interval '30 days')::date as due_date,
    i.amount_due as outstanding_amount,
    i.status as invoice_status,
    CASE
        WHEN (current_date - i.invoice_date) <= 30 THEN 'current'
        WHEN (current_date - i.invoice_date) <= 60 THEN '1-30'
        WHEN (current_date - i.invoice_date) <= 90 THEN '31-60'
        WHEN (current_date - i.invoice_date) <= 120 THEN '61-90'
        ELSE '90+'
    END as aging_bucket
FROM dw.fct_invoice i
JOIN dw.dim_customer c ON i.customer_id = c.customer_id
WHERE
    -- Only unpaid invoices with amount due
    i.status NOT IN ('VOIDED', 'DELETED', 'PAID')
    AND i.amount_due > 0
    -- Only sales invoices (exclude bills/ACCPAY)
    AND (i.document_type IN ('ACCREC', 'Tax Invoice') OR i.document_type IS NULL)
    -- Exclude archived customers
    AND (c.archived = false OR c.archived IS NULL)
    -- Exclude pure suppliers (allow 'customer' and 'both')
    AND (c.customer_type != 'supplier' OR c.customer_type IS NULL);

-- Add comment to document the view
COMMENT ON VIEW mart.vw_statement_details IS
'Outstanding sales invoices for customer statement generation.
Excludes bills (ACCPAY), archived customers, and pure suppliers.';

-- ============================================================================
-- PHASE 4: Budget Functions for Budget Selector
-- ============================================================================

-- Function to get list of available budgets for dropdown
CREATE OR REPLACE FUNCTION public.get_available_budgets()
RETURNS TABLE(
    budget_name text,
    month_count bigint,
    total_amount numeric,
    min_date date,
    max_date date
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        b.budget_name::text,
        COUNT(DISTINCT b.month_date)::bigint as month_count,
        SUM(b.amount)::numeric as total_amount,
        MIN(b.month_date)::date as min_date,
        MAX(b.month_date)::date as max_date
    FROM dw.fct_budget b
    WHERE b.budget_name IS NOT NULL
    GROUP BY b.budget_name
    ORDER BY b.budget_name;
END;
$$;

-- Update get_budget_vs_actual to accept budget_name parameter
-- Must drop ALL existing versions of this function (PostgreSQL requires this when changing return type)
DROP FUNCTION IF EXISTS public.get_budget_vs_actual(date, date);
DROP FUNCTION IF EXISTS public.get_budget_vs_actual(date, date, text);

CREATE OR REPLACE FUNCTION public.get_budget_vs_actual(
    p_start_date date,
    p_end_date date,
    p_budget_name text DEFAULT NULL
)
RETURNS TABLE(
    month_date date,
    actual_revenue numeric,
    budget_amount numeric,
    variance numeric,
    variance_pct numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH monthly_actuals AS (
        SELECT
            date_trunc('month', s.invoice_date)::date as month_dt,
            SUM(s.line_amount) as revenue
        FROM mart.sales_enriched s
        WHERE s.invoice_date BETWEEN p_start_date AND p_end_date
        GROUP BY 1
    ),
    monthly_budgets AS (
        SELECT
            b.month_date as month_dt,
            SUM(b.amount) as budget_amt
        FROM dw.fct_budget b
        WHERE b.month_date BETWEEN p_start_date AND p_end_date
          AND (p_budget_name IS NULL OR b.budget_name = p_budget_name)
        GROUP BY 1
    )
    SELECT
        COALESCE(a.month_dt, b.month_dt) as month_date,
        COALESCE(a.revenue, 0)::numeric as actual_revenue,
        COALESCE(b.budget_amt, 0)::numeric as budget_amount,
        (COALESCE(a.revenue, 0) - COALESCE(b.budget_amt, 0))::numeric as variance,
        CASE
            WHEN COALESCE(b.budget_amt, 0) = 0 THEN 0
            ELSE ROUND(((COALESCE(a.revenue, 0) - COALESCE(b.budget_amt, 0)) / b.budget_amt * 100)::numeric, 1)
        END as variance_pct
    FROM monthly_actuals a
    FULL OUTER JOIN monthly_budgets b ON a.month_dt = b.month_dt
    ORDER BY month_date;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.get_available_budgets() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_budget_vs_actual(date, date, text) TO anon, authenticated;

-- ============================================================================
-- PHASE 5: Update Sales Enriched View (if needed)
-- ============================================================================

-- Ensure mart.sales_enriched exists and includes necessary columns
-- This is typically created in views.sql but we ensure it works with our changes

-- ============================================================================
-- VERIFICATION QUERIES (for testing)
-- ============================================================================

-- To verify migration worked, run these queries:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'dw' AND table_name = 'dim_customer' ORDER BY ordinal_position;
-- SELECT * FROM mart.vw_statement_details LIMIT 10;
-- SELECT * FROM get_available_budgets();
-- SELECT * FROM get_budget_vs_actual('2025-01-01', '2025-12-31', NULL);
