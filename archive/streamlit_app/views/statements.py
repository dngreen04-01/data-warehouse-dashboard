import streamlit as st
from data_access import fetch_statement_data
from statement_generator import generate_statement_pdf, sanitize_filename

def render_statements(reference_data):
    """Renders the Statement Generation view."""
    st.header("Customer Statements")
    st.markdown("Generate and download PDF statements for parent customers (merchant groups).")
    
    merchant_groups_df = reference_data.get("merchant_groups")
    
    if merchant_groups_df is not None and not merchant_groups_df.empty:
        parent_customers = sorted(merchant_groups_df["merchant_group"].dropna().unique().tolist())
    else:
        parent_customers = []

    if not parent_customers:
        st.warning("No parent customers (merchant groups) found in reference data.")
        return

    col1, col2 = st.columns([1, 2])
    
    with col1:
        selected_parent = st.selectbox("Select Parent Customer", parent_customers)
        generate_btn = st.button("Preview Statement", type="primary")

    with col2:
        # Place holder for future options like date range
        pass

    if generate_btn or st.session_state.get("last_statement_parent") == selected_parent:
        st.session_state["last_statement_parent"] = selected_parent
        
        with st.spinner("Fetching statement data..."):
            try:
                statement_data = fetch_statement_data(selected_parent)
                
                if statement_data.empty:
                    st.info(f"No outstanding invoices found for {selected_parent}.")
                else:
                    st.subheader(f"Statement Preview: {selected_parent}")
                    st.dataframe(
                        statement_data[['invoice_date', 'invoice_number', 'customer_name', 'outstanding_amount', 'aging_bucket']],
                        use_container_width=True,
                        hide_index=True
                    )
                    
                    try:
                        pdf_bytes = generate_statement_pdf(statement_data)
                        safe_filename = sanitize_filename(selected_parent)
                        
                        st.download_button(
                            label="Download PDF Statement",
                            data=pdf_bytes,
                            file_name=f"Statement_{safe_filename}.pdf",
                            mime="application/pdf",
                        )
                    except Exception as e:
                        st.error(f"Error generating PDF: {e}")
                        
            except Exception as e:
                st.error(f"Failed to load data: {e}")
