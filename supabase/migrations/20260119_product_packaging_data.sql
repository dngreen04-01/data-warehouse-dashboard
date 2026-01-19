-- Populate packaging dimensions for products from CSV data
-- Source: product dims.csv
-- Note: CSV dimensions are in cm, converting to mm (multiply by 10)

UPDATE dw.dim_product SET
    carton_width_mm = 370,
    carton_height_mm = 290,
    carton_depth_mm = 470,
    carton_weight_kg = 11.5,
    cartons_per_pallet = 30
WHERE product_id = 13;

UPDATE dw.dim_product SET
    carton_width_mm = 370,
    carton_height_mm = 290,
    carton_depth_mm = 470,
    carton_weight_kg = 11.5,
    cartons_per_pallet = 30
WHERE product_id = 14;

UPDATE dw.dim_product SET
    carton_width_mm = 310,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 14,
    cartons_per_pallet = 25
WHERE product_id = 15;

UPDATE dw.dim_product SET
    carton_width_mm = 310,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 13.5,
    cartons_per_pallet = 25
WHERE product_id = 16;

UPDATE dw.dim_product SET
    carton_width_mm = 370,
    carton_height_mm = 290,
    carton_depth_mm = 470,
    carton_weight_kg = 11.5,
    cartons_per_pallet = 30
WHERE product_id = 1142;

UPDATE dw.dim_product SET
    carton_width_mm = 340,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 16,
    cartons_per_pallet = 20
WHERE product_id = 18;

UPDATE dw.dim_product SET
    carton_width_mm = 340,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 13.5,
    cartons_per_pallet = 20
WHERE product_id = 19;

UPDATE dw.dim_product SET
    carton_width_mm = 340,
    carton_height_mm = 330,
    carton_depth_mm = 410,
    carton_weight_kg = 12.2,
    cartons_per_pallet = 44
WHERE product_id = 20;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 400,
    carton_depth_mm = 590,
    carton_weight_kg = 15,
    cartons_per_pallet = 15
WHERE product_id = 21;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 400,
    carton_depth_mm = 590,
    carton_weight_kg = 16.2,
    cartons_per_pallet = 15
WHERE product_id = 22;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 400,
    carton_depth_mm = 590,
    carton_weight_kg = 15.8,
    cartons_per_pallet = 15
WHERE product_id = 23;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 400,
    carton_depth_mm = 590,
    carton_weight_kg = 17.8,
    cartons_per_pallet = 15
WHERE product_id = 24;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 260,
    carton_depth_mm = 590,
    carton_weight_kg = 17.5,
    cartons_per_pallet = 30
WHERE product_id = 29;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 260,
    carton_depth_mm = 590,
    carton_weight_kg = 17.5,
    cartons_per_pallet = 30
WHERE product_id = 30;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 280,
    carton_depth_mm = 590,
    carton_weight_kg = 13.5,
    cartons_per_pallet = 25
WHERE product_id = 31;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 260,
    carton_depth_mm = 590,
    carton_weight_kg = 17.5,
    cartons_per_pallet = 30
WHERE product_id = 32;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 260,
    carton_depth_mm = 590,
    carton_weight_kg = 17.5,
    cartons_per_pallet = 30
WHERE product_id = 33;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 280,
    carton_depth_mm = 590,
    carton_weight_kg = 13.5,
    cartons_per_pallet = 25
WHERE product_id = 34;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 400,
    carton_depth_mm = 590,
    carton_weight_kg = 15.8,
    cartons_per_pallet = 20
WHERE product_id = 39;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 400,
    carton_depth_mm = 590,
    carton_weight_kg = 16,
    cartons_per_pallet = 20
WHERE product_id = 40;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 280,
    carton_weight_kg = 15.8,
    cartons_per_pallet = 20
WHERE product_id = 41;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 280,
    carton_weight_kg = 16,
    cartons_per_pallet = 20
WHERE product_id = 42;

UPDATE dw.dim_product SET
    carton_width_mm = 380,
    carton_height_mm = 290,
    carton_depth_mm = 590,
    carton_weight_kg = 11.1,
    cartons_per_pallet = 25
WHERE product_id = 45;

UPDATE dw.dim_product SET
    carton_width_mm = 310,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 11,
    cartons_per_pallet = 20
WHERE product_id = 48;

UPDATE dw.dim_product SET
    carton_width_mm = 310,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 11,
    cartons_per_pallet = 20
WHERE product_id = 49;

UPDATE dw.dim_product SET
    carton_width_mm = 360,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 11,
    cartons_per_pallet = 20
WHERE product_id = 50;

UPDATE dw.dim_product SET
    carton_width_mm = 360,
    carton_height_mm = 400,
    carton_depth_mm = 600,
    carton_weight_kg = 11,
    cartons_per_pallet = 20
WHERE product_id = 51;

UPDATE dw.dim_product SET
    carton_width_mm = 210,
    carton_height_mm = 160,
    carton_depth_mm = 260,
    carton_weight_kg = 1.3,
    cartons_per_pallet = NULL
WHERE product_id = 46;

UPDATE dw.dim_product SET
    carton_width_mm = 450,
    carton_height_mm = 320,
    carton_depth_mm = 320,
    carton_weight_kg = 14,
    cartons_per_pallet = NULL
WHERE product_id = 52;

UPDATE dw.dim_product SET
    carton_width_mm = 450,
    carton_height_mm = 320,
    carton_depth_mm = 320,
    carton_weight_kg = 14,
    cartons_per_pallet = NULL
WHERE product_id = 53;

UPDATE dw.dim_product SET
    carton_width_mm = 450,
    carton_height_mm = 320,
    carton_depth_mm = 320,
    carton_weight_kg = 14,
    cartons_per_pallet = NULL
WHERE product_id = 54;

UPDATE dw.dim_product SET
    carton_width_mm = 450,
    carton_height_mm = 320,
    carton_depth_mm = 320,
    carton_weight_kg = 14,
    cartons_per_pallet = NULL
WHERE product_id = 55;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 580,
    carton_weight_kg = 13.6,
    cartons_per_pallet = 25
WHERE product_id = 61;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 580,
    carton_weight_kg = 13.6,
    cartons_per_pallet = 25
WHERE product_id = 62;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 280,
    carton_depth_mm = 510,
    carton_weight_kg = 7,
    cartons_per_pallet = 48
WHERE product_id = 65;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 580,
    carton_weight_kg = 13.6,
    cartons_per_pallet = 25
WHERE product_id = 67;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 580,
    carton_weight_kg = 13.6,
    cartons_per_pallet = 25
WHERE product_id = 68;

UPDATE dw.dim_product SET
    carton_width_mm = 270,
    carton_height_mm = 380,
    carton_depth_mm = 580,
    carton_weight_kg = 13.6,
    cartons_per_pallet = 25
WHERE product_id = 1143;

UPDATE dw.dim_product SET
    carton_width_mm = 230,
    carton_height_mm = 260,
    carton_depth_mm = 230,
    carton_weight_kg = 18,
    cartons_per_pallet = 40
WHERE product_id = 71;

UPDATE dw.dim_product SET
    carton_width_mm = 200,
    carton_height_mm = 210,
    carton_depth_mm = 200,
    carton_weight_kg = 12.8,
    cartons_per_pallet = 40
WHERE product_id = 73;

UPDATE dw.dim_product SET
    carton_width_mm = 250,
    carton_height_mm = 200,
    carton_depth_mm = 150,
    carton_weight_kg = 6.6,
    cartons_per_pallet = 40
WHERE product_id = 75;
