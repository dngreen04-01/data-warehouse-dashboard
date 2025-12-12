import streamlit as st
import pandas as pd
import pendulum
from data_access import (
    next_product_id,
    upsert_product,
    get_connection
)
from data_management import (
    get_products_to_archive,
    archive_products_by_ids,
    unarchive_product
)

def render_products(reference_data):
    """Renders the Product Management view."""
    st.header("Product Management")
    
    tabs = st.tabs(["Edit Product", "Archive & Restore"])

    # --- Tab 1: Edit Product ---
    with tabs[0]:
        st.subheader("Add or Update Product")
        product_list = reference_data["products"]
        
        col_sel, _ = st.columns([1, 2])
        with col_sel:
            product_names = ["Create new"] + sorted(product_list["item_name"].tolist())
            selected_product = st.selectbox("Select product to edit", product_names)

        if selected_product == "Create new":
            product_id = next_product_id()
            product_data = {
                "product_code": "", "item_name": "", "item_description": "",
                "product_group": "", "price": 0.0, "gross_price": 0.0,
            }
        else:
            record = product_list.loc[product_list["item_name"] == selected_product].iloc[0]
            product_id = record["product_id"]
            product_data = record.to_dict()

        with st.form("product_form"):
            c1, c2 = st.columns(2)
            with c1:
                item_name = st.text_input("Item Name", product_data.get("item_name", ""))
                product_code = st.text_input("Product Code", product_data.get("product_code", ""))
                product_group = st.text_input("Product Group", product_data.get("product_group", ""))
            
            with c2:
                price = st.number_input("Net Price", value=float(product_data.get("price", 0.0)))
                gross_price = st.number_input("Gross Price", value=float(product_data.get("gross_price", 0.0)))
            
            item_description = st.text_area("Description", product_data.get("item_description", ""), height=100)

            submitted = st.form_submit_button("Save Product", type="primary")
            if submitted:
                payload = {
                    "product_id": product_id,
                    "product_code": product_code,
                    "item_name": item_name,
                    "item_description": item_description,
                    "product_group": product_group,
                    "price": price,
                    "gross_price": gross_price,
                }
                upsert_product(payload)
                st.success(f"Product '{item_name}' saved.")
                st.cache_data.clear()
                st.rerun()

    # --- Tab 2: Archive & Restore ---
    with tabs[1]:
        st.subheader("Archive Inactive Products")
        
        col_arch_1, col_arch_2 = st.columns(2)
        with col_arch_1:
            archive_date = st.date_input(
                "Archive if no sales after",
                value=pendulum.now().subtract(years=5).date()
            )
        with col_arch_2:
            st.write("")
            st.write("")
            if st.button("Scan for Inactive Products"):
                with get_connection() as conn:
                    to_archive = get_products_to_archive(conn, str(archive_date))
                    st.session_state['prod_archive_preview'] = to_archive

        if 'prod_archive_preview' in st.session_state:
            to_archive = st.session_state['prod_archive_preview']
            if not to_archive:
                st.info("No inactive products found.")
            else:
                st.warning(f"Found {len(to_archive)} inactive products.")
                
                df_arch = pd.DataFrame(to_archive)
                if not df_arch.empty:
                    st.dataframe(
                        df_arch[['product_code', 'item_name', 'product_group']], 
                        use_container_width=True, height=200
                    )
                
                exclude_ids = st.multiselect(
                    "Exclude from archive",
                    options=[p['product_id'] for p in to_archive],
                    format_func=lambda i: next((f"{p['item_name']} ({p['product_code']})" for p in to_archive if p['product_id'] == i), i)
                )
                
                final_ids = [p['product_id'] for p in to_archive if p['product_id'] not in exclude_ids]
                
                if st.button(f"Confirm Archive ({len(final_ids)} Products)", type="primary", disabled=not final_ids):
                    with get_connection() as conn:
                        archive_products_by_ids(conn, final_ids)
                    st.success("Archived successfully.")
                    del st.session_state['prod_archive_preview']
                    st.cache_data.clear()
                    st.rerun()

        st.markdown("---")
        st.subheader("Restore Archived Products")
        
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT product_id, product_code, item_name 
                    FROM dw.dim_product WHERE archived = true ORDER BY item_name
                """)
                archived_list = cur.fetchall()
        
        if archived_list:
            p_restore_sel, p_restore_btn = st.columns([3, 1])
            with p_restore_sel:
                restore_id = st.selectbox(
                    "Select product to restore",
                    options=[p['product_id'] for p in archived_list],
                    format_func=lambda i: next((f"{p['item_name']} ({p['product_code']})" for p in archived_list if p['product_id'] == i), i)
                )
            with p_restore_btn:
                st.write("")
                st.write("")
                if st.button("Restore Product"):
                    with get_connection() as conn:
                        unarchive_product(conn, restore_id)
                    st.success("Restored.")
                    st.cache_data.clear()
                    st.rerun()
        else:
            st.caption("No archived products.")
