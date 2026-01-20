-- Migration: Add WIP (Work-in-Progress) product support
-- Milestone 1: Database schema changes for WIP products

-- Add product_type column to distinguish finished from WIP products
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'finished';

COMMENT ON COLUMN dw.dim_product.product_type IS
'Type of product: finished (default, sellable), wip (work-in-progress at supplier)';

-- Add wip_for_cluster_id column to link WIP products to their parent cluster
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS wip_for_cluster_id integer REFERENCES dw.dim_cluster(cluster_id);

COMMENT ON COLUMN dw.dim_product.wip_for_cluster_id IS
'For WIP products: the product cluster this WIP inventory represents unpacked stock for';

-- Create index for efficient lookups of WIP products by cluster
CREATE INDEX IF NOT EXISTS idx_dim_product_wip_cluster
ON dw.dim_product(wip_for_cluster_id) WHERE wip_for_cluster_id IS NOT NULL;

-- Add production_capacity_per_day column for WIP products
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS production_capacity_per_day numeric(18,2);

COMMENT ON COLUMN dw.dim_product.production_capacity_per_day IS
'For WIP products: max base units that can be packed/produced per day';

-- Add check constraint to ensure WIP products always have a cluster link
-- Using DO block to make constraint addition idempotent
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'dw'
        AND table_name = 'dim_product'
        AND constraint_name = 'chk_wip_product_has_cluster'
    ) THEN
        ALTER TABLE dw.dim_product
        ADD CONSTRAINT chk_wip_product_has_cluster
        CHECK (
            (product_type = 'wip' AND wip_for_cluster_id IS NOT NULL) OR
            (product_type != 'wip')
        );
    END IF;
END $$;
