-- Extend update_product RPC to handle packaging fields
-- Each field uses COALESCE pattern: null = keep existing, non-null = update

CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL,
    p_carton_width_mm integer DEFAULT NULL,
    p_carton_height_mm integer DEFAULT NULL,
    p_carton_depth_mm integer DEFAULT NULL,
    p_carton_weight_kg numeric DEFAULT NULL,
    p_cartons_per_pallet integer DEFAULT NULL
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
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id;
END;
$$;

-- Ensure authenticated users can call this function
GRANT EXECUTE ON FUNCTION public.update_product(bigint, text, integer, integer, integer, numeric, integer) TO authenticated;
