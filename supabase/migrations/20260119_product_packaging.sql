-- Add packaging information columns to dim_product
-- These fields capture carton dimensions for shipping/logistics planning

ALTER TABLE dw.dim_product
ADD COLUMN carton_width_mm integer,
ADD COLUMN carton_height_mm integer,
ADD COLUMN carton_depth_mm integer,
ADD COLUMN carton_weight_kg numeric(8, 3),
ADD COLUMN cartons_per_pallet integer;

-- Add comments for documentation
COMMENT ON COLUMN dw.dim_product.carton_width_mm IS 'Carton width in millimeters';
COMMENT ON COLUMN dw.dim_product.carton_height_mm IS 'Carton height in millimeters';
COMMENT ON COLUMN dw.dim_product.carton_depth_mm IS 'Carton depth in millimeters';
COMMENT ON COLUMN dw.dim_product.carton_weight_kg IS 'Carton weight in kilograms';
COMMENT ON COLUMN dw.dim_product.cartons_per_pallet IS 'Number of cartons per pallet';
