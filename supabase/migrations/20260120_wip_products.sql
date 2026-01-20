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

-- ============================================================================
-- Milestone 2: Auto-Create "XXX Unpacked" Products for Each Product Cluster
-- ============================================================================

-- Function to create WIP products for all existing product clusters
-- Returns info about each cluster and whether a WIP product was created
CREATE OR REPLACE FUNCTION public.create_wip_products_for_clusters()
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    wip_product_id bigint,
    wip_product_code text,
    created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cluster RECORD;
    v_product_id bigint;
    v_product_code text;
    v_item_name text;
    v_created boolean;
BEGIN
    FOR v_cluster IN
        SELECT c.cluster_id, c.cluster_label
        FROM dw.dim_cluster c
        WHERE c.cluster_type = 'product'
        ORDER BY c.cluster_id
    LOOP
        -- Generate product code from cluster label (uppercase, replace spaces with underscores)
        v_product_code := UPPER(REGEXP_REPLACE(v_cluster.cluster_label, '\s+', '_', 'g')) || '_UNPACKED';
        v_item_name := v_cluster.cluster_label || ' Unpacked';

        -- Check if WIP product already exists for this cluster
        SELECT p.product_id INTO v_product_id
        FROM dw.dim_product p
        WHERE p.wip_for_cluster_id = v_cluster.cluster_id
          AND p.product_type = 'wip';

        IF v_product_id IS NULL THEN
            -- Generate a unique product_id (9000000 + cluster_id to avoid collisions)
            v_product_id := 9000000 + v_cluster.cluster_id;

            -- Check if this ID is already used, if so find next available
            WHILE EXISTS (SELECT 1 FROM dw.dim_product WHERE product_id = v_product_id) LOOP
                v_product_id := v_product_id + 1000;
            END LOOP;

            INSERT INTO dw.dim_product (
                product_id,
                product_code,
                item_name,
                product_type,
                wip_for_cluster_id,
                is_tracked_as_inventory,
                archived,
                created_at,
                updated_at
            ) VALUES (
                v_product_id,
                v_product_code,
                v_item_name,
                'wip',
                v_cluster.cluster_id,
                true,
                false,
                NOW(),
                NOW()
            );

            v_created := true;
        ELSE
            v_created := false;
        END IF;

        cluster_id := v_cluster.cluster_id;
        cluster_label := v_cluster.cluster_label;
        wip_product_id := v_product_id;
        wip_product_code := v_product_code;
        created := v_created;
        RETURN NEXT;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_wip_products_for_clusters() TO authenticated;

COMMENT ON FUNCTION public.create_wip_products_for_clusters() IS
'Creates one WIP "Unpacked" product for each product cluster that does not already have one.
Returns list of all clusters with their WIP product info and whether it was newly created.';

-- Trigger function to auto-create WIP product when a new product cluster is created
CREATE OR REPLACE FUNCTION dw.auto_create_wip_for_new_cluster()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id bigint;
    v_product_code text;
    v_item_name text;
BEGIN
    -- Only for product clusters
    IF NEW.cluster_type = 'product' THEN
        v_product_code := UPPER(REGEXP_REPLACE(NEW.cluster_label, '\s+', '_', 'g')) || '_UNPACKED';
        v_item_name := NEW.cluster_label || ' Unpacked';
        v_product_id := 9000000 + NEW.cluster_id;

        -- Find unique ID
        WHILE EXISTS (SELECT 1 FROM dw.dim_product WHERE product_id = v_product_id) LOOP
            v_product_id := v_product_id + 1000;
        END LOOP;

        INSERT INTO dw.dim_product (
            product_id, product_code, item_name, product_type,
            wip_for_cluster_id, is_tracked_as_inventory, archived,
            created_at, updated_at
        ) VALUES (
            v_product_id, v_product_code, v_item_name, 'wip',
            NEW.cluster_id, true, false,
            NOW(), NOW()
        );
    END IF;

    RETURN NEW;
END;
$$;

-- Create the trigger (drop first if exists for idempotence)
DROP TRIGGER IF EXISTS trg_auto_create_wip_product ON dw.dim_cluster;
CREATE TRIGGER trg_auto_create_wip_product
    AFTER INSERT ON dw.dim_cluster
    FOR EACH ROW
    EXECUTE FUNCTION dw.auto_create_wip_for_new_cluster();

COMMENT ON FUNCTION dw.auto_create_wip_for_new_cluster() IS
'Trigger function that automatically creates a WIP product when a new product cluster is created.';
