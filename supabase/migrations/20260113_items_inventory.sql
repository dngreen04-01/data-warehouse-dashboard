-- Migration: Add Xero Items inventory fields to dim_product
-- Date: 2026-01-13
-- Purpose: Store inventory tracking data from Xero Items API

-- Add new columns for Xero Items data
ALTER TABLE dw.dim_product
    ADD COLUMN IF NOT EXISTS xero_item_id text,
    ADD COLUMN IF NOT EXISTS is_tracked_as_inventory boolean DEFAULT false,
    ADD COLUMN IF NOT EXISTS inventory_asset_account_code text,
    ADD COLUMN IF NOT EXISTS total_cost_pool numeric(18,2),
    ADD COLUMN IF NOT EXISTS quantity_on_hand numeric(18,4),
    ADD COLUMN IF NOT EXISTS purchase_unit_price numeric(18,4),
    ADD COLUMN IF NOT EXISTS cogs_account_code text,
    ADD COLUMN IF NOT EXISTS sales_account_code text;

-- Index for efficient Xero item lookups
CREATE INDEX IF NOT EXISTS idx_dim_product_xero_item_id
    ON dw.dim_product(xero_item_id)
    WHERE xero_item_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN dw.dim_product.xero_item_id IS 'Xero ItemID (GUID) for linking to Xero Items API';
COMMENT ON COLUMN dw.dim_product.is_tracked_as_inventory IS 'Whether item is tracked as inventory in Xero';
COMMENT ON COLUMN dw.dim_product.inventory_asset_account_code IS 'Xero account code for inventory asset (tracked items)';
COMMENT ON COLUMN dw.dim_product.total_cost_pool IS 'Total value of inventory on hand';
COMMENT ON COLUMN dw.dim_product.quantity_on_hand IS 'Current stock quantity';
COMMENT ON COLUMN dw.dim_product.purchase_unit_price IS 'Purchase cost per unit from Xero PurchaseDetails';
COMMENT ON COLUMN dw.dim_product.cogs_account_code IS 'Xero account code for cost of goods sold';
COMMENT ON COLUMN dw.dim_product.sales_account_code IS 'Xero account code for sales revenue';
