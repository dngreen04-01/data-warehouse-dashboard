-- Production Conversion History Table
-- Tracks bulk material conversions to finished goods for manufacturing process

CREATE TABLE IF NOT EXISTS dw.production_conversion (
    conversion_id bigserial PRIMARY KEY,
    conversion_date timestamptz NOT NULL DEFAULT timezone('utc', now()),

    -- Bulk material consumed
    bulk_product_code text NOT NULL,
    bulk_product_name text,
    bags_consumed numeric(10,2) NOT NULL,
    kg_consumed numeric(10,4) NOT NULL,
    bulk_unit_cost numeric(18,4) NOT NULL,
    bulk_total_value numeric(18,2) NOT NULL,

    -- Finished goods produced (JSONB array)
    -- Format: [{"product_code": "KLIPTUIT03", "product_name": "...", "quantity": 100, "unit_cost": 1.10, "total_value": 110.00}]
    finished_goods jsonb NOT NULL,

    -- Xero document references
    xero_credit_note_id text,      -- Credit note that decreased bulk stock
    xero_invoice_id text,          -- Invoice that increased finished stock

    -- Audit fields
    created_by text,
    created_at timestamptz DEFAULT timezone('utc', now()),
    notes text
);

-- Index for querying by date range
CREATE INDEX IF NOT EXISTS idx_production_conversion_date
    ON dw.production_conversion(conversion_date DESC);

-- Index for querying by bulk product
CREATE INDEX IF NOT EXISTS idx_production_conversion_bulk_code
    ON dw.production_conversion(bulk_product_code);

-- Comment on table
COMMENT ON TABLE dw.production_conversion IS 'Audit trail for manufacturing conversions from bulk to finished goods';
COMMENT ON COLUMN dw.production_conversion.finished_goods IS 'JSONB array of finished products created: [{product_code, product_name, quantity, unit_cost, total_value}]';


-- RPC function to insert a conversion record
CREATE OR REPLACE FUNCTION public.insert_production_conversion(
    p_conversion_date timestamptz,
    p_bulk_product_code text,
    p_bulk_product_name text,
    p_bags_consumed numeric,
    p_kg_consumed numeric,
    p_bulk_unit_cost numeric,
    p_bulk_total_value numeric,
    p_finished_goods jsonb,
    p_xero_credit_note_id text DEFAULT NULL,
    p_xero_invoice_id text DEFAULT NULL,
    p_created_by text DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_conversion_id bigint;
BEGIN
    INSERT INTO dw.production_conversion (
        conversion_date,
        bulk_product_code,
        bulk_product_name,
        bags_consumed,
        kg_consumed,
        bulk_unit_cost,
        bulk_total_value,
        finished_goods,
        xero_credit_note_id,
        xero_invoice_id,
        created_by,
        notes
    ) VALUES (
        COALESCE(p_conversion_date, timezone('utc', now())),
        p_bulk_product_code,
        p_bulk_product_name,
        p_bags_consumed,
        p_kg_consumed,
        p_bulk_unit_cost,
        p_bulk_total_value,
        p_finished_goods,
        p_xero_credit_note_id,
        p_xero_invoice_id,
        p_created_by,
        p_notes
    )
    RETURNING conversion_id INTO v_conversion_id;

    RETURN v_conversion_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_production_conversion(
    timestamptz, text, text, numeric, numeric, numeric, numeric, jsonb, text, text, text, text
) TO authenticated;


-- RPC function to get conversion history
CREATE OR REPLACE FUNCTION public.get_production_conversions(
    p_limit int DEFAULT 50,
    p_offset int DEFAULT 0
)
RETURNS TABLE (
    conversion_id bigint,
    conversion_date timestamptz,
    bulk_product_code text,
    bulk_product_name text,
    bags_consumed numeric,
    kg_consumed numeric,
    bulk_unit_cost numeric,
    bulk_total_value numeric,
    finished_goods jsonb,
    xero_credit_note_id text,
    xero_invoice_id text,
    created_by text,
    created_at timestamptz,
    notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        pc.conversion_id,
        pc.conversion_date,
        pc.bulk_product_code,
        pc.bulk_product_name,
        pc.bags_consumed,
        pc.kg_consumed,
        pc.bulk_unit_cost,
        pc.bulk_total_value,
        pc.finished_goods,
        pc.xero_credit_note_id,
        pc.xero_invoice_id,
        pc.created_by,
        pc.created_at,
        pc.notes
    FROM dw.production_conversion pc
    ORDER BY pc.conversion_date DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_production_conversions(int, int) TO authenticated;


-- RPC function to get manufacturing products (bulk and finished)
CREATE OR REPLACE FUNCTION public.get_manufacturing_products()
RETURNS TABLE (
    product_code text,
    item_name text,
    product_type text,
    bag_weight_kg numeric,
    converts_to text[],
    quantity_on_hand numeric,
    purchase_unit_price numeric,
    inventory_asset_account_code text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.product_code,
        p.item_name,
        CASE
            WHEN p.product_code IN ('TUIT_CL_UP', 'TUIT_NY_UP') THEN 'bulk'
            WHEN p.product_code IN ('KLIPTUIT02', 'KLIPTUIT03', 'KLIPTUIT04', 'KLIPTUIT05') THEN 'finished'
            ELSE 'other'
        END as product_type,
        CASE
            WHEN p.product_code = 'TUIT_CL_UP' THEN 11.0
            WHEN p.product_code = 'TUIT_NY_UP' THEN 10.0
            ELSE NULL
        END as bag_weight_kg,
        CASE
            WHEN p.product_code = 'TUIT_CL_UP' THEN ARRAY['KLIPTUIT02', 'KLIPTUIT03']
            WHEN p.product_code = 'TUIT_NY_UP' THEN ARRAY['KLIPTUIT04', 'KLIPTUIT05']
            ELSE NULL
        END as converts_to,
        p.quantity_on_hand,
        p.purchase_unit_price,
        p.inventory_asset_account_code
    FROM dw.dim_product p
    WHERE p.product_code IN (
        'TUIT_CL_UP', 'TUIT_NY_UP',           -- Bulk materials
        'KLIPTUIT02', 'KLIPTUIT03',            -- Cotton finished
        'KLIPTUIT04', 'KLIPTUIT05'             -- Nylon finished
    )
    AND p.archived = false
    ORDER BY
        CASE WHEN p.product_code IN ('TUIT_CL_UP', 'TUIT_NY_UP') THEN 0 ELSE 1 END,
        p.product_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_manufacturing_products() TO authenticated;
