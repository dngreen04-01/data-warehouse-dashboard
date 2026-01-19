-- Add price list fields to dim_product
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS price_list_price numeric(18,2),
ADD COLUMN IF NOT EXISTS bulk_price numeric(18,2);

COMMENT ON COLUMN dw.dim_product.price_list_price IS 'Optional custom price for price list exports (overrides Xero price)';
COMMENT ON COLUMN dw.dim_product.bulk_price IS 'Bulk order price for 10+ cartons';

-- Extend update_product RPC to handle new fields
CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL,
    p_carton_width_mm integer DEFAULT NULL,
    p_carton_height_mm integer DEFAULT NULL,
    p_carton_depth_mm integer DEFAULT NULL,
    p_carton_weight_kg numeric DEFAULT NULL,
    p_cartons_per_pallet integer DEFAULT NULL,
    p_price_list_price numeric DEFAULT NULL,
    p_bulk_price numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE dw.dim_product
    SET
        product_group = COALESCE(p_product_group, product_group),
        carton_width_mm = COALESCE(p_carton_width_mm, carton_width_mm),
        carton_height_mm = COALESCE(p_carton_height_mm, carton_height_mm),
        carton_depth_mm = COALESCE(p_carton_depth_mm, carton_depth_mm),
        carton_weight_kg = COALESCE(p_carton_weight_kg, carton_weight_kg),
        cartons_per_pallet = COALESCE(p_cartons_per_pallet, cartons_per_pallet),
        price_list_price = COALESCE(p_price_list_price, price_list_price),
        bulk_price = COALESCE(p_bulk_price, bulk_price),
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.update_product(bigint, text, integer, integer, integer, numeric, integer, numeric, numeric) TO authenticated;
