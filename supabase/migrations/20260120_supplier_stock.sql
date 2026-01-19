-- =============================================================================
-- Supplier Stock Entry Schema Migration
-- =============================================================================
-- This migration creates:
-- 1. 'supplier' role in the RBAC system
-- 2. supplier_stock_entry table for weekly stock holdings
-- 3. Helper function for week-ending date calculation
-- 4. RPC functions for supplier portal data access
-- 5. RLS policies for data security
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add 'supplier' role to app_roles
-- -----------------------------------------------------------------------------
INSERT INTO dw.app_roles (role_id, role_name, description, is_system_role)
VALUES ('supplier', 'Supplier', 'External supplier with portal access', false)
ON CONFLICT (role_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Create supplier_stock_entry table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.supplier_stock_entry (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES dw.dim_product(product_id),
    quantity_on_hand integer NOT NULL DEFAULT 0,
    week_ending date NOT NULL,
    created_at timestamptz DEFAULT timezone('utc', now()),
    updated_at timestamptz DEFAULT timezone('utc', now()),
    UNIQUE (user_id, product_id, week_ending)
);

-- Add indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_supplier_stock_user_week
    ON dw.supplier_stock_entry(user_id, week_ending);
CREATE INDEX IF NOT EXISTS idx_supplier_stock_product
    ON dw.supplier_stock_entry(product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_stock_week_ending
    ON dw.supplier_stock_entry(week_ending);

COMMENT ON TABLE dw.supplier_stock_entry IS 'Stores weekly stock holdings reported by suppliers';
COMMENT ON COLUMN dw.supplier_stock_entry.week_ending IS 'Saturday of the reporting week';
COMMENT ON COLUMN dw.supplier_stock_entry.quantity_on_hand IS 'Number of units supplier has in stock';

-- -----------------------------------------------------------------------------
-- 3. Create helper function to get current week ending date (Saturday)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION dw.get_week_ending(d date DEFAULT CURRENT_DATE)
RETURNS date AS $$
BEGIN
    -- Returns the Saturday of the week containing date d
    -- PostgreSQL: dow 0=Sunday, 6=Saturday
    RETURN d + (6 - EXTRACT(dow FROM d)::integer);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION dw.get_week_ending IS 'Returns Saturday (week-ending date) for any given date';

-- -----------------------------------------------------------------------------
-- 4. Create RPC function to get products with clusters for supplier view
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_products_for_supplier_stock()
RETURNS TABLE (
    product_id bigint,
    product_code text,
    item_name text,
    cluster_id integer,
    cluster_label text
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.product_id,
        p.product_code,
        p.item_name,
        c.cluster_id,
        c.cluster_label
    FROM dw.dim_product p
    LEFT JOIN dw.dim_product_cluster pc ON p.product_id = pc.product_id
    LEFT JOIN dw.dim_cluster c ON pc.cluster_id = c.cluster_id AND c.cluster_type = 'product'
    WHERE p.archived = false
      AND p.is_tracked_as_inventory = true
    ORDER BY c.cluster_label NULLS LAST, p.item_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_products_for_supplier_stock() TO authenticated;

COMMENT ON FUNCTION public.get_products_for_supplier_stock IS 'Returns all inventory-tracked products grouped by product cluster for supplier stock entry';

-- -----------------------------------------------------------------------------
-- 5. Create RPC function to get supplier's stock entries for current and previous week
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_stock_entries(p_user_id uuid)
RETURNS TABLE (
    product_id bigint,
    current_week_qty integer,
    previous_week_qty integer
) AS $$
DECLARE
    v_current_week date;
    v_previous_week date;
BEGIN
    v_current_week := dw.get_week_ending(CURRENT_DATE);
    v_previous_week := v_current_week - 7;

    RETURN QUERY
    SELECT
        p.product_id,
        curr.quantity_on_hand as current_week_qty,
        prev.quantity_on_hand as previous_week_qty
    FROM dw.dim_product p
    LEFT JOIN dw.supplier_stock_entry curr
        ON p.product_id = curr.product_id
        AND curr.user_id = p_user_id
        AND curr.week_ending = v_current_week
    LEFT JOIN dw.supplier_stock_entry prev
        ON p.product_id = prev.product_id
        AND prev.user_id = p_user_id
        AND prev.week_ending = v_previous_week
    WHERE p.archived = false
      AND p.is_tracked_as_inventory = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.get_supplier_stock_entries(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_supplier_stock_entries IS 'Returns current and previous week stock entries for a specific supplier';

-- -----------------------------------------------------------------------------
-- 6. Create RPC function to save stock entries
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_supplier_stock_entries(
    p_entries jsonb  -- Array of {product_id, quantity_on_hand}
)
RETURNS jsonb AS $$
DECLARE
    v_user_id uuid;
    v_week_ending date;
    v_entry jsonb;
    v_count integer := 0;
BEGIN
    v_user_id := auth.uid();
    v_week_ending := dw.get_week_ending(CURRENT_DATE);

    -- Verify user has supplier role
    IF NOT EXISTS (
        SELECT 1 FROM dw.user_roles ur
        WHERE ur.user_id = v_user_id
        AND ur.role_id IN ('supplier', 'super_user')
    ) THEN
        RAISE EXCEPTION 'Access denied: supplier role required';
    END IF;

    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
    LOOP
        INSERT INTO dw.supplier_stock_entry (user_id, product_id, quantity_on_hand, week_ending)
        VALUES (
            v_user_id,
            (v_entry->>'product_id')::bigint,
            (v_entry->>'quantity_on_hand')::integer,
            v_week_ending
        )
        ON CONFLICT (user_id, product_id, week_ending)
        DO UPDATE SET
            quantity_on_hand = EXCLUDED.quantity_on_hand,
            updated_at = timezone('utc', now());

        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'status', 'ok',
        'entries_saved', v_count,
        'week_ending', v_week_ending
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';

GRANT EXECUTE ON FUNCTION public.save_supplier_stock_entries(jsonb) TO authenticated;

COMMENT ON FUNCTION public.save_supplier_stock_entries IS 'Upserts stock entries for the current week for the authenticated supplier';

-- -----------------------------------------------------------------------------
-- 7. Add RLS policies for supplier_stock_entry
-- -----------------------------------------------------------------------------
ALTER TABLE dw.supplier_stock_entry ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (makes migration idempotent)
DROP POLICY IF EXISTS supplier_stock_select ON dw.supplier_stock_entry;
DROP POLICY IF EXISTS supplier_stock_insert ON dw.supplier_stock_entry;
DROP POLICY IF EXISTS supplier_stock_update ON dw.supplier_stock_entry;

-- Suppliers can only see their own entries
CREATE POLICY supplier_stock_select ON dw.supplier_stock_entry
    FOR SELECT USING (auth.uid() = user_id);

-- Suppliers can insert their own entries
CREATE POLICY supplier_stock_insert ON dw.supplier_stock_entry
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Suppliers can update their own entries
CREATE POLICY supplier_stock_update ON dw.supplier_stock_entry
    FOR UPDATE USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 8. Grant permissions for authenticated users to read product/cluster data
-- (These may already exist but we use IF NOT EXISTS pattern via DO block)
-- -----------------------------------------------------------------------------
GRANT SELECT ON dw.supplier_stock_entry TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Add supplier-specific permissions to permissions table
-- -----------------------------------------------------------------------------
INSERT INTO dw.permissions (permission_id, permission_name, category, description) VALUES
    ('supplier.stock.view', 'View Stock Entry', 'supplier', 'Can view supplier stock entry page'),
    ('supplier.stock.edit', 'Edit Stock Entry', 'supplier', 'Can submit stock entries')
ON CONFLICT (permission_id) DO NOTHING;

-- Grant supplier permissions to supplier role
INSERT INTO dw.role_permissions (role_id, permission_id)
VALUES
    ('supplier', 'supplier.stock.view'),
    ('supplier', 'supplier.stock.edit')
ON CONFLICT DO NOTHING;

-- Grant supplier permissions to super_user role (for testing)
INSERT INTO dw.role_permissions (role_id, permission_id)
VALUES
    ('super_user', 'supplier.stock.view'),
    ('super_user', 'supplier.stock.edit')
ON CONFLICT DO NOTHING;
