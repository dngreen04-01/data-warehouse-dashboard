-- Migration: Customer Price Lists Schema
-- Purpose: Enable customer-specific pricing with price overrides

-- 1. Create the price list header table
CREATE TABLE dw.customer_price_list (
    price_list_id serial PRIMARY KEY,
    customer_id text NOT NULL REFERENCES dw.dim_customer(customer_id),
    name text NOT NULL DEFAULT 'Custom Prices',
    description text,
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_customer_price_list_customer ON dw.customer_price_list(customer_id);
CREATE INDEX idx_customer_price_list_active ON dw.customer_price_list(customer_id, is_active)
    WHERE is_active = true;

-- 2. Create the price override table
CREATE TABLE dw.customer_price_override (
    override_id serial PRIMARY KEY,
    price_list_id integer NOT NULL REFERENCES dw.customer_price_list(price_list_id) ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES dw.dim_product(product_id),
    custom_price numeric(18,2) NOT NULL,
    custom_bulk_price numeric(18,2),
    notes text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT unique_product_per_list UNIQUE (price_list_id, product_id)
);

CREATE INDEX idx_customer_price_override_list ON dw.customer_price_override(price_list_id);
CREATE INDEX idx_customer_price_override_product ON dw.customer_price_override(product_id);

-- 3. Add flag to dim_customer for quick lookup
ALTER TABLE dw.dim_customer
ADD COLUMN IF NOT EXISTS has_custom_price_list boolean DEFAULT false;

-- 4. Create trigger to maintain the flag
CREATE OR REPLACE FUNCTION dw.update_customer_price_list_flag()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE dw.dim_customer
        SET has_custom_price_list = EXISTS (
            SELECT 1 FROM dw.customer_price_list
            WHERE customer_id = NEW.customer_id AND is_active = true
        )
        WHERE customer_id = NEW.customer_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE dw.dim_customer
        SET has_custom_price_list = EXISTS (
            SELECT 1 FROM dw.customer_price_list
            WHERE customer_id = OLD.customer_id AND is_active = true
        )
        WHERE customer_id = OLD.customer_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_customer_price_list_flag
AFTER INSERT OR UPDATE OR DELETE ON dw.customer_price_list
FOR EACH ROW EXECUTE FUNCTION dw.update_customer_price_list_flag();

-- 5. Create helper view for effective price lookup
CREATE OR REPLACE VIEW dw.vw_customer_product_price AS
SELECT
    c.customer_id,
    c.customer_name,
    p.product_id,
    p.product_code,
    p.item_name,
    p.price as default_price,
    p.price_list_price as default_price_list_price,
    p.bulk_price as default_bulk_price,
    cpl.price_list_id,
    cpl.name as price_list_name,
    cpo.custom_price,
    cpo.custom_bulk_price,
    COALESCE(cpo.custom_price, p.price_list_price, p.price) as effective_price,
    COALESCE(cpo.custom_bulk_price, p.bulk_price) as effective_bulk_price,
    CASE WHEN cpo.override_id IS NOT NULL THEN true ELSE false END as has_custom_price
FROM dw.dim_customer c
CROSS JOIN dw.dim_product p
LEFT JOIN dw.customer_price_list cpl ON cpl.customer_id = c.customer_id
    AND cpl.is_active = true
    AND cpl.effective_to IS NULL
LEFT JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
    AND cpo.product_id = p.product_id
WHERE p.archived = false
  AND p.is_tracked_as_inventory = true
  AND c.archived = false;

-- 6. Create RPC function for frontend
CREATE OR REPLACE FUNCTION public.get_customer_price_list(p_customer_id text)
RETURNS TABLE (
    price_list_id integer,
    name text,
    description text,
    effective_from date,
    override_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        cpl.price_list_id,
        cpl.name,
        cpl.description,
        cpl.effective_from,
        COUNT(cpo.override_id) as override_count
    FROM dw.customer_price_list cpl
    LEFT JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
    WHERE cpl.customer_id = p_customer_id
      AND cpl.is_active = true
      AND cpl.effective_to IS NULL
    GROUP BY cpl.price_list_id, cpl.name, cpl.description, cpl.effective_from;
$$;

-- 7. Create price lookup function for future invoicing
CREATE OR REPLACE FUNCTION dw.get_customer_price(
    p_customer_id text,
    p_product_id bigint,
    p_quantity integer DEFAULT 1
)
RETURNS TABLE (
    unit_price numeric,
    price_source text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_custom_price numeric;
    v_custom_bulk_price numeric;
    v_default_price numeric;
    v_default_bulk_price numeric;
    v_price_list_price numeric;
BEGIN
    SELECT cpo.custom_price, cpo.custom_bulk_price
    INTO v_custom_price, v_custom_bulk_price
    FROM dw.customer_price_list cpl
    JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
    WHERE cpl.customer_id = p_customer_id
      AND cpl.is_active = true
      AND cpl.effective_to IS NULL
      AND cpo.product_id = p_product_id;

    SELECT p.price, p.bulk_price, p.price_list_price
    INTO v_default_price, v_default_bulk_price, v_price_list_price
    FROM dw.dim_product p
    WHERE p.product_id = p_product_id;

    IF v_custom_price IS NOT NULL THEN
        IF p_quantity >= 10 AND v_custom_bulk_price IS NOT NULL THEN
            RETURN QUERY SELECT v_custom_bulk_price, 'custom_bulk'::text;
        ELSE
            RETURN QUERY SELECT v_custom_price, 'custom'::text;
        END IF;
    ELSIF v_price_list_price IS NOT NULL THEN
        IF p_quantity >= 10 AND v_default_bulk_price IS NOT NULL THEN
            RETURN QUERY SELECT v_default_bulk_price, 'price_list_bulk'::text;
        ELSE
            RETURN QUERY SELECT v_price_list_price, 'price_list'::text;
        END IF;
    ELSE
        IF p_quantity >= 10 AND v_default_bulk_price IS NOT NULL THEN
            RETURN QUERY SELECT v_default_bulk_price, 'default_bulk'::text;
        ELSE
            RETURN QUERY SELECT v_default_price, 'default'::text;
        END IF;
    END IF;
END;
$$;

-- 8. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON dw.customer_price_list TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON dw.customer_price_override TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE dw.customer_price_list_price_list_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE dw.customer_price_override_override_id_seq TO authenticated;
GRANT SELECT ON dw.vw_customer_product_price TO authenticated;
