import streamlit as st
import pandas as pd
import pendulum
from data_access import (
    next_customer_id,
    upsert_customer,
    get_connection
)
from data_management import (
    find_customer_matches,
    merge_customers,
    get_customers_to_archive,
    archive_customers_by_ids,
    unarchive_customer,
    CustomerMatch
)

def render_customers(reference_data):
    """Renders the Customer Management view."""
    st.header("Customer Management")
    
    tabs = st.tabs(["Edit Customer", "Deduplication", "Archive & Restore"])

    # --- Tab 1: Edit Customer ---
    with tabs[0]:
        st.subheader("Add or Update Customer")
        customer_list = reference_data["customers"]
        
        # Select Customer
        col_sel, _ = st.columns([1, 2])
        with col_sel:
            existing_names = ["Create new"] + sorted(customer_list["customer_name"].tolist())
            selected_customer = st.selectbox("Select customer to edit", existing_names)

        if selected_customer == "Create new":
            customer_id = next_customer_id()
            customer_data = {
                "customer_name": "", "contact_name": "", "phone": "", "fax": "",
                "bill_to": "", "balance_total": 0.0, "market": "Local",
                "merchant_group": "", "xero_account_number": "",
            }
        else:
            record = customer_list.loc[customer_list["customer_name"] == selected_customer].iloc[0]
            customer_id = record["customer_id"]
            customer_data = record.to_dict()

        st.markdown("#### Customer Details")
        with st.form("customer_form"):
            c1, c2 = st.columns(2)
            with c1:
                name = st.text_input("Customer Name", customer_data.get("customer_name", ""))
                contact = st.text_input("Contact Person", customer_data.get("contact_name", ""))
                phone = st.text_input("Phone", customer_data.get("phone", ""))
                fax = st.text_input("Fax", customer_data.get("fax", ""))
                
            with c2:
                market_options = ["Local", "Export", "Unknown"]
                current_market = customer_data.get("market", "Local")
                market_idx = market_options.index(current_market) if current_market in market_options else 0
                market = st.selectbox("Market", market_options, index=market_idx)
                
                merchant_group_val = st.text_input("Parent Customer (Merchant Group)", customer_data.get("merchant_group", ""))
                account_number = st.text_input("Xero Account #", customer_data.get("xero_account_number", ""))
                balance = st.number_input("Opening Balance", value=float(customer_data.get("balance_total", 0.0)))

            bill_to = st.text_area("Billing Address", customer_data.get("bill_to", ""), height=100)
            
            submitted = st.form_submit_button("Save Customer", type="primary")
            if submitted:
                payload = {
                    "customer_id": customer_id,
                    "customer_name": name,
                    "contact_name": contact,
                    "phone": phone,
                    "fax": fax,
                    "bill_to": bill_to,
                    "balance_total": balance,
                    "market": market,
                    "merchant_group": merchant_group_val,
                    "xero_account_number": account_number,
                }
                upsert_customer(payload)
                st.success(f"Customer '{name}' saved successfully.")
                st.cache_data.clear()
                st.rerun()

    # --- Tab 2: Deduplication ---
    with tabs[1]:
        st.subheader("Merge Duplicate Customers")
        st.markdown("Find and merge Xero customers into historical records.")

        all_customers = reference_data["customers"]
        
        # Heuristic for Xero vs Historical (UUID vs Int/String)
        # In a real app, we might have a 'source' column, but we use the pattern matcher from original code
        def is_xero_customer(cid):
            import re
            return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', str(cid), re.I))

        xero_customers = all_customers[all_customers['customer_id'].apply(is_xero_customer)]
        historical_customers = all_customers[~all_customers['customer_id'].apply(is_xero_customer)]
        
        col_search, col_info = st.columns([1, 2])
        with col_search:
            min_score = st.slider("Match Sensitivity", 0.3, 0.9, 0.5, 0.05, help="Higher means stricter matching")
            if st.button("Find Matches", type="primary"):
                with st.spinner("Analyzing..."):
                    matches = find_customer_matches(xero_customers, historical_customers, min_score)
                    st.session_state['customer_matches'] = matches
        
        with col_info:
            st.info(f"Analyzing {len(xero_customers)} new vs {len(historical_customers)} historical records.")

        if 'customer_matches' in st.session_state and st.session_state['customer_matches']:
            matches = st.session_state['customer_matches']
            st.write(f"Found {len(matches)} potential matches.")
            
            # Prepare dataframe for display
            match_data = [{
                'New Customer (Xero)': m.xero_customer_name,
                'Historical Match': m.historical_customer_name,
                'Confidence': f"{m.similarity_score:.0%}",
                'Type': m.match_type
            } for m in matches]
            
            st.dataframe(pd.DataFrame(match_data), use_container_width=True)
            
            # Merge Action
            st.markdown("### Apply Merges")
            selected_indices = st.multiselect(
                "Select matches to merge",
                options=range(len(matches)),
                format_func=lambda i: f"{matches[i].xero_customer_name} ➔ {matches[i].historical_customer_name}"
            )
            
            if selected_indices and st.button("Merge Selected Records"):
                with get_connection() as conn:
                    total = 0
                    for idx in selected_indices:
                        m = matches[idx]
                        total += merge_customers(conn, m.xero_customer_id, m.historical_customer_id)
                
                st.success(f"Merged {len(selected_indices)} customers (updated {total} records).")
                del st.session_state['customer_matches']
                st.cache_data.clear()
                st.rerun()

    # --- Tab 3: Archive & Restore ---
    with tabs[2]:
        st.subheader("Archive Inactive Customers")
        
        col_arch_1, col_arch_2 = st.columns(2)
        with col_arch_1:
            archive_date = st.date_input(
                "Archive if no activity after",
                value=pendulum.now().subtract(years=5).date()
            )
        with col_arch_2:
            st.write("") # Spacer
            st.write("")
            if st.button("Scan for Inactive Customers"):
                with get_connection() as conn:
                    to_archive = get_customers_to_archive(conn, str(archive_date))
                    st.session_state['cust_archive_preview'] = to_archive

        if 'cust_archive_preview' in st.session_state:
            to_archive = st.session_state['cust_archive_preview']
            if not to_archive:
                st.info("No inactive customers found for this period.")
            else:
                st.warning(f"Found {len(to_archive)} inactive customers.")
                df_arch = pd.DataFrame(to_archive)
                if not df_arch.empty:
                    st.dataframe(
                        df_arch[['customer_name', 'market', 'merchant_group']].rename(columns={'customer_name': 'Name'}), 
                        use_container_width=True, height=200
                    )
                
                # Exclude option
                exclude_ids = st.multiselect(
                    "Exclude from archive (Keep Active)",
                    options=[c['customer_id'] for c in to_archive],
                    format_func=lambda i: next((c['customer_name'] for c in to_archive if c['customer_id'] == i), i)
                )
                
                final_ids = [c['customer_id'] for c in to_archive if c['customer_id'] not in exclude_ids]
                
                if st.button(f"Confirm Archive ({len(final_ids)} Customers)", type="primary", disabled=not final_ids):
                    with get_connection() as conn:
                        archive_customers_by_ids(conn, final_ids)
                    st.success("Archived successfully.")
                    del st.session_state['cust_archive_preview']
                    st.cache_data.clear()
                    st.rerun()

        st.markdown("---")
        st.subheader("Restore Archived Customers")
        
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT customer_id, customer_name, market, merged_into
                    FROM dw.dim_customer WHERE archived = true ORDER BY customer_name
                """)
                archived_list = cur.fetchall()
        
        if archived_list:
            c_restore_sel, c_restore_btn = st.columns([3, 1])
            with c_restore_sel:
                restore_id = st.selectbox(
                    "Select customer to restore",
                    options=[c['customer_id'] for c in archived_list],
                    format_func=lambda i: next(((f"{c['customer_name']} (Merged: {c['merged_into']})" if c['merged_into'] else c['customer_name']) for c in archived_list if c['customer_id'] == i), i)
            )
            with c_restore_btn:
                st.write("")
                st.write("")
                if st.button("Restore"):
                    with get_connection() as conn:
                        unarchive_customer(conn, restore_id)
                    st.success("Restored.")
                    st.cache_data.clear()
                    st.rerun()
        else:
            st.caption("No archived customers.")
