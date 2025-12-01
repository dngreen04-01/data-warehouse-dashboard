from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd
import pendulum
import plotly.express as px
import streamlit as st
from dotenv import load_dotenv

import sys
from pathlib import Path

# Add app directory to path for imports when running from project root
sys.path.insert(0, str(Path(__file__).parent))

from data_access import (
    DateFilters,
    fetch_breakdown,
    fetch_comparison_metrics,
    fetch_reference_data,
    fetch_sales_timeseries,
    fetch_top_performers,
    fetch_transactions,
    fetch_year_over_year_breakdown,
    fetch_cluster_members,
    next_customer_id,
    next_product_id,
    upsert_customer,
    upsert_product,
    get_connection,
    fetch_archived_customers,
    fetch_archived_products,
    fetch_xero_customers,
    fetch_historical_customers,
)
from data_management import (
    find_customer_matches,
    merge_customers,
    archive_customers_by_date,
    archive_products_by_date,
    get_archive_preview,
    get_customers_to_archive,
    get_products_to_archive,
    archive_customers_by_ids,
    archive_products_by_ids,
    unarchive_customer,
    unarchive_product,
)

load_dotenv()

st.set_page_config(
    page_title="Unified Sales & Operations Dashboard",
    page_icon="📊",
    layout="wide",
)

st.title("Unified Sales & Operations Dashboard")


@st.cache_data(ttl=300)
def load_reference_tables() -> Dict[str, pd.DataFrame]:
    frames = fetch_reference_data()
    # Ensure clean product groups list
    product_groups = (
        frames["products"]["product_group"].fillna("Unknown").unique().tolist()
        if not frames["products"].empty
        else []
    )
    frames["product_groups"] = pd.DataFrame({"product_group": sorted(product_groups)})
    return frames


reference_data = load_reference_tables()


def serialize_filters(filters: Dict[str, List[str]]) -> Tuple[Tuple[str, Tuple[str, ...]], ...]:
    return tuple((key, tuple(sorted(values))) for key, values in sorted(filters.items()))


def sidebar_filters() -> tuple[Dict[str, List[str]], DateFilters]:
    st.sidebar.header("Filters")

    date_default_end = pendulum.now("UTC").date()
    date_default_start = date_default_end.subtract(months=12)
    date_range = st.sidebar.date_input(
        "Date range",
        (date_default_start, date_default_end),
    )
    if isinstance(date_range, tuple):
        start_date, end_date = date_range
    else:
        start_date = date_range
        end_date = date_range

    customers = reference_data["customers"]
    products = reference_data["products"]
    clusters = reference_data["clusters"]
    merchant_groups = reference_data.get("merchant_groups")
    markets = reference_data.get("markets")
    product_groups = reference_data.get("product_groups")

    filter_values: Dict[str, List[str]] = {}

    if not customers.empty:
        selected_customers = st.sidebar.multiselect(
            "Customers",
            customers["customer_name"].tolist(),
        )
        if selected_customers:
            ids = customers.loc[customers["customer_name"].isin(selected_customers), "customer_id"].astype(str)
            filter_values["customer_id"] = ids.tolist()
    if merchant_groups is not None and not merchant_groups.empty:
        selected_parent = st.sidebar.multiselect(
            "Parent customers",
            merchant_groups["merchant_group"].dropna().tolist(),
        )
        if selected_parent:
            filter_values["merchant_group"] = selected_parent
    if clusters is not None and not clusters.empty:
        selected_clusters = st.sidebar.multiselect(
            "Customer clusters",
            clusters["cluster_label"].tolist(),
        )
        if selected_clusters:
            ids = clusters.loc[clusters["cluster_label"].isin(selected_clusters), "cluster_id"].astype(int)
            filter_values["cluster_id"] = ids.tolist()
    if markets is not None and not markets.empty:
        selected_markets = st.sidebar.multiselect(
            "Markets",
            markets["market"].dropna().tolist(),
        )
        if selected_markets:
            filter_values["market"] = selected_markets
    if product_groups is not None and not product_groups.empty:
        selected_product_groups = st.sidebar.multiselect(
            "Product groups",
            product_groups["product_group"].fillna("Unknown").tolist(),
        )
        if selected_product_groups:
            filter_values["product_group"] = selected_product_groups
    if not products.empty:
        selected_products = st.sidebar.multiselect(
            "Products",
            products["item_name"].tolist(),
        )
        if selected_products:
            ids = products.loc[products["item_name"].isin(selected_products), "product_id"].astype(int)
            filter_values["product_id"] = ids.tolist()

    date_filters = DateFilters(
        start_date=start_date.isoformat() if start_date else None,
        end_date=end_date.isoformat() if end_date else None,
    )

    return filter_values, date_filters


filters, date_filters = sidebar_filters()


@st.cache_data(ttl=300)
def load_time_series(
    filters_serialized: Tuple[Tuple[str, Tuple[str, ...]], ...],
    start: str | None,
    end: str | None,
) -> pd.DataFrame:
    filters_payload = {key: list(values) for key, values in filters_serialized}
    return fetch_sales_timeseries(filters_payload, DateFilters(start, end))


@st.cache_data(ttl=300)
def load_yoy_table(
    filters_serialized: Tuple[Tuple[str, Tuple[str, ...]], ...],
    dimension: str,
    start: str | None,
    end: str | None,
) -> pd.DataFrame:
    filters_payload = {key: list(values) for key, values in filters_serialized}
    return fetch_year_over_year_breakdown(dimension, filters_payload, start, end)


@st.cache_data(ttl=300)
def load_cluster_members_table() -> pd.DataFrame:
    return fetch_cluster_members()


filters_serialized = serialize_filters(filters)
time_series = load_time_series(filters_serialized, date_filters.start_date, date_filters.end_date)

if time_series.empty:
    st.info("No sales data for the selected filters. Adjust filters to see results.")
else:
    current_end = pendulum.parse(date_filters.end_date) if date_filters.end_date else pendulum.now()
    comparison_df = fetch_comparison_metrics(current_end, filters)

    st.subheader("Key Performance Indicators")
    kpi_cols = st.columns(len(comparison_df))
    for idx, row in comparison_df.iterrows():
        delta = row["current_revenue"] - row["previous_revenue"]
        delta_pct = (delta / row["previous_revenue"] * 100) if row["previous_revenue"] else None
        with kpi_cols[idx]:
            st.metric(
                label=row["period"],
                value=f"${row['current_revenue']:,.0f}",
                delta=f"{delta_pct:.1f}% vs LY" if delta_pct is not None else "N/A",
            )

    st.subheader("Sales Over Time")
    chart_df = time_series.copy()
    chart_df["invoice_date"] = pd.to_datetime(chart_df["invoice_date"], errors="coerce")
    chart_df = chart_df.dropna(subset=["invoice_date"]).sort_values("invoice_date")

    chart_start = pendulum.parse(date_filters.start_date) if date_filters.start_date else current_end.subtract(months=12)
    prev_start = chart_start.subtract(years=1)
    prev_end = (pendulum.parse(date_filters.end_date) if date_filters.end_date else current_end).subtract(years=1)
    prev_series = load_time_series(filters_serialized, prev_start.to_date_string(), prev_end.to_date_string())
    prev_series = prev_series.copy()
    if not prev_series.empty:
        prev_series["invoice_date"] = pd.to_datetime(prev_series["invoice_date"], errors="coerce") + pd.DateOffset(years=1)
        prev_series = prev_series.dropna(subset=["invoice_date"])
        prev_series = prev_series.rename(columns={"revenue": "prior_revenue"})
        merged = pd.merge(chart_df, prev_series[["invoice_date", "prior_revenue"]], on="invoice_date", how="left")
    else:
        merged = chart_df.assign(prior_revenue=None)

    merged['revenue'] = pd.to_numeric(merged['revenue'], errors='coerce').fillna(0.0)
    merged['prior_revenue'] = pd.to_numeric(merged['prior_revenue'], errors='coerce').fillna(0.0)
    plot_df = merged[["invoice_date"]].copy()
    plot_df['TY Revenue'] = merged['revenue'].cumsum()
    plot_df['LY Revenue'] = merged['prior_revenue'].cumsum()
    fig = px.line(
        plot_df,
        x="invoice_date",
        y=["TY Revenue", "LY Revenue"],
        labels={"value": "Revenue", "invoice_date": "Invoice Date", "variable": "Series"},
        title="Revenue vs Prior Year (Cumulative)",
    )
    fig.update_layout(legend=dict(title=""))
    st.plotly_chart(fig, use_container_width=True)

    st.subheader("Breakdown Views")
    breakdown_cols = st.columns(2)
    breakdown_dimensions = [
        ("market", "Revenue by Market"),
        ("merchant_group", "Revenue by Parent Customer"),
        ("product_group", "Revenue by Product Group"),
        ("cluster", "Revenue by Customer Cluster"),
    ]
    for idx, (dimension, title) in enumerate(breakdown_dimensions):
        df = fetch_breakdown(dimension, filters, date_filters)
        col = breakdown_cols[idx % 2]
        with col:
            if df.empty:
                st.write(f"No data for {title}.")
                continue
            fig = px.bar(df.head(25), x="label", y="revenue", title=title)
            fig.update_layout(xaxis_title="", yaxis_title="Revenue", xaxis_tickangle=-45)
            st.plotly_chart(fig, use_container_width=True)

    st.subheader("Top Performers")
    top_cols = st.columns(3)
    top_config = [
        ("products", "Top Products"),
        ("customers", "Top Customers"),
        ("parent_customers", "Top Parent Customers"),
    ]
    for idx, (dimension, title) in enumerate(top_config):
        df = fetch_top_performers(dimension, filters, date_filters)
        with top_cols[idx]:
            if df.empty:
                st.write("No data available")
            else:
                df = df.copy()
                if 'revenue' in df.columns:
                    df['revenue'] = pd.to_numeric(df['revenue'], errors='coerce').fillna(0.0)
                if 'quantity' in df.columns:
                    df['quantity'] = pd.to_numeric(df['quantity'], errors='coerce').fillna(0.0)
                st.dataframe(df.style.format({"revenue": "${:,.0f}", "quantity": "{:,.0f}"}), use_container_width=True)

    st.subheader("Customer Sales (YoY)")
    customer_dimension_options = {
        "Customers": ("customer", "Customer"),
        "Parent Customers": ("merchant_group", "Parent Customer"),
        "Customer Clusters": ("cluster", "Customer Cluster"),
        "Markets": ("market", "Market"),
    }
    customer_choice = st.selectbox(
        "Group customer metrics by",
        list(customer_dimension_options.keys()),
        key="customer_yoy_dimension",
    )
    customer_dimension, customer_label = customer_dimension_options[customer_choice]
    customer_yoy = load_yoy_table(filters_serialized, customer_dimension, date_filters.start_date, date_filters.end_date)
    if customer_yoy.empty:
        st.write("No customer sales for the current filters.")
    else:
        customer_display = customer_yoy.copy().rename(columns={"label": customer_label})
        value_columns = [col for col in ["TY", "LY", "LLY", "LLLY"] if col in customer_display.columns]
        if not value_columns:
            st.write("No customer sales for the current filters.")
        else:
            for col in value_columns:
                customer_display[col] = pd.to_numeric(customer_display[col], errors="coerce").fillna(0.0)
            customer_display = customer_display[[customer_label] + value_columns]
            customer_display = customer_display.sort_values(value_columns[0], ascending=False).head(100)
            st.dataframe(
                customer_display.style.format({col: "${:,.0f}" for col in value_columns}),
                use_container_width=True,
            )

    st.subheader("Product Sales (YoY)")
    product_dimension_options = {
        "Products": ("product", "Product"),
        "Product Groups": ("product_group", "Product Group"),
    }
    product_choice = st.selectbox(
        "Group product metrics by",
        list(product_dimension_options.keys()),
        key="product_yoy_dimension",
    )
    product_dimension, product_label = product_dimension_options[product_choice]
    product_yoy = load_yoy_table(filters_serialized, product_dimension, date_filters.start_date, date_filters.end_date)
    if product_yoy.empty:
        st.write("No product sales for the current filters.")
    else:
        product_display = product_yoy.copy().rename(columns={"label": product_label})
        value_columns = [col for col in ["TY", "LY", "LLY", "LLLY"] if col in product_display.columns]
        if not value_columns:
            st.write("No product sales for the current filters.")
        else:
            for col in value_columns:
                product_display[col] = pd.to_numeric(product_display[col], errors="coerce").fillna(0.0)
            product_display = product_display[[product_label] + value_columns]
            product_display = product_display.sort_values(value_columns[0], ascending=False).head(100)
            st.dataframe(
                product_display.style.format({col: "${:,.0f}" for col in value_columns}),
                use_container_width=True,
            )


    st.subheader("Customer Cluster Membership")
    cluster_members = load_cluster_members_table()
    if cluster_members.empty:
        st.write("No customer clusters found.")
    else:
        cluster_members = cluster_members.copy()
        cluster_members['cluster_label'] = cluster_members[['cluster_id', 'cluster_label']].apply(
            lambda row: row['cluster_label'] if isinstance(row['cluster_label'], str) and row['cluster_label'] else (f"Cluster {int(row['cluster_id'])}" if pd.notna(row['cluster_id']) else 'Unknown'),
            axis=1,
        )
        cluster_members['customer_name'] = cluster_members['customer_name'].fillna('Unknown Customer')
        grouped = cluster_members.groupby(['cluster_id', 'cluster_label'])
        cluster_display = grouped['customer_name'].apply(lambda names: '\n'.join(sorted(set(names)))).reset_index(name='Customers')
        cluster_display['Customer Count'] = grouped['customer_id'].nunique().values
        cluster_display = cluster_display[['cluster_label', 'Customer Count', 'Customers']].sort_values('cluster_label')
        st.dataframe(cluster_display, use_container_width=True, hide_index=True)

    st.subheader("Transaction Details")
    st.subheader("Transaction Details")
    transactions = fetch_transactions(filters, date_filters)
    if transactions.empty:
        st.write("No transactions found.")
    else:
        st.dataframe(transactions, use_container_width=True, hide_index=True)
        st.download_button(
            "Download CSV",
            data=transactions.to_csv(index=False).encode("utf-8"),
            file_name="transactions.csv",
            mime="text/csv",
        )

st.markdown("---")
st.header("Data Maintenance")

maintenance_tabs = st.tabs(["Customers", "Products"])

with maintenance_tabs[0]:
    st.subheader("Add or Update Customer")
    customer_list = reference_data["customers"]
    existing_names = ["Create new"] + customer_list["customer_name"].tolist()
    selected_customer = st.selectbox("Select customer", existing_names)

    if selected_customer == "Create new":
        customer_id = next_customer_id()
        customer_data = {
            "customer_name": "",
            "contact_name": "",
            "phone": "",
            "fax": "",
            "bill_to": "",
            "balance_total": 0,
            "market": "Local",
            "merchant_group": "",
            "xero_account_number": "",
        }
    else:
        record = customer_list.loc[customer_list["customer_name"] == selected_customer].iloc[0]
        customer_id = record["customer_id"]
        customer_data = record.to_dict()

    with st.form("customer_form"):
        name = st.text_input("Customer name", customer_data.get("customer_name", ""))
        contact = st.text_input("Contact name", customer_data.get("contact_name", ""))
        phone = st.text_input("Phone", customer_data.get("phone", ""))
        fax = st.text_input("Fax", customer_data.get("fax", ""))
        bill_to = st.text_area("Billing address", customer_data.get("bill_to", ""))
        balance = st.number_input("Balance total", value=float(customer_data.get("balance_total", 0.0)))
        market_options = ["Local", "Export", "Unknown"]
        current_market = customer_data.get("market", "Local")
        market_index = market_options.index(current_market) if current_market in market_options else 0
        market = st.selectbox("Market", market_options, index=market_index)
        merchant_group_val = st.text_input("Merchant group", customer_data.get("merchant_group", ""))
        account_number = st.text_input("Xero account number", customer_data.get("xero_account_number", ""))
        submitted = st.form_submit_button("Save customer")
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
            st.success(f"Customer '{name}' saved.")
            st.cache_data.clear()

with maintenance_tabs[1]:
    st.subheader("Add or Update Product")
    product_list = reference_data["products"]
    product_names = ["Create new"] + product_list["item_name"].tolist()
    selected_product = st.selectbox("Select product", product_names)

    if selected_product == "Create new":
        product_id = next_product_id()
        product_data = {
            "product_code": "",
            "item_name": "",
            "item_description": "",
            "product_group": "",
            "price": 0,
            "gross_price": 0,
        }
    else:
        record = product_list.loc[product_list["item_name"] == selected_product].iloc[0]
        product_id = record["product_id"]
        product_data = record.to_dict()

    with st.form("product_form"):
        product_code = st.text_input("Product code", product_data.get("product_code", ""))
        item_name = st.text_input("Item name", product_data.get("item_name", ""))
        item_description = st.text_area("Item description", product_data.get("item_description", ""))
        product_group = st.text_input("Product group", product_data.get("product_group", ""))
        price = st.number_input("Price", value=float(product_data.get("price", 0.0)))
        gross_price = st.number_input("Gross price", value=float(product_data.get("gross_price", 0.0)))
        submitted = st.form_submit_button("Save product")
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

# Data Management Section
st.markdown("---")
st.header("Data Management")

data_mgmt_tabs = st.tabs(["Customer Matching", "Bulk Archive", "Archived Records"])

with data_mgmt_tabs[0]:
    st.subheader("Match Xero Customers to Historical Records")
    st.markdown("""
    This tool finds potential matches between newly imported Xero customers and your historical customer records.
    Review the suggestions below and confirm matches to merge duplicate records.
    """)

    # Get customers - Xero customers typically have UUID-style IDs
    all_customers = reference_data["customers"]

    # Identify Xero customers (UUID format) vs historical (numeric or specific patterns)
    def is_xero_customer(cid):
        if not cid:
            return False
        cid_str = str(cid)
        # UUID pattern: 8-4-4-4-12 hex chars
        import re
        return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', cid_str, re.I))

    xero_customers = all_customers[all_customers['customer_id'].apply(is_xero_customer)]
    historical_customers = all_customers[~all_customers['customer_id'].apply(is_xero_customer)]

    st.info(f"Found {len(xero_customers)} Xero customers and {len(historical_customers)} historical customers")

    if len(xero_customers) > 0 and len(historical_customers) > 0:
        min_score = st.slider("Minimum match score", 0.3, 0.9, 0.5, 0.05)

        if st.button("Find Matches", key="find_matches_btn"):
            with st.spinner("Analyzing customer names..."):
                matches = find_customer_matches(xero_customers, historical_customers, min_score)
            # Store matches in session state
            st.session_state['customer_matches'] = matches
            if not matches:
                st.session_state['customer_matches'] = []

        # Display matches from session state (persists across reruns)
        if 'customer_matches' in st.session_state and st.session_state['customer_matches']:
            matches = st.session_state['customer_matches']
            st.success(f"Found {len(matches)} potential matches")

            # Display matches in a table
            match_data = []
            for m in matches:
                match_data.append({
                    'Xero Customer': m.xero_customer_name,
                    'Historical Customer': m.historical_customer_name,
                    'Score': f"{m.similarity_score:.0%}",
                    'Match Type': m.match_type,
                    'xero_id': m.xero_customer_id,
                    'hist_id': m.historical_customer_id,
                })

            match_df = pd.DataFrame(match_data)
            st.dataframe(
                match_df[['Xero Customer', 'Historical Customer', 'Score', 'Match Type']],
                use_container_width=True
            )

            # Allow user to select and merge
            st.markdown("### Merge Selected Matches")
            selected_idx = st.multiselect(
                "Select matches to merge (Xero -> Historical)",
                options=range(len(matches)),
                format_func=lambda i: f"{matches[i].xero_customer_name} -> {matches[i].historical_customer_name}",
                key="merge_selection"
            )

            if selected_idx and st.button("Merge Selected", type="primary", key="merge_btn"):
                with get_connection() as conn:
                    total_updated = 0
                    for idx in selected_idx:
                        m = matches[idx]
                        updated = merge_customers(conn, m.xero_customer_id, m.historical_customer_id)
                        total_updated += updated
                        st.write(f"Merged '{m.xero_customer_name}' -> '{m.historical_customer_name}' ({updated} records)")

                st.success(f"Merged {len(selected_idx)} customers. Updated {total_updated} transaction records.")
                # Clear matches from session state after merge
                del st.session_state['customer_matches']
                st.cache_data.clear()
                st.rerun()

        elif 'customer_matches' in st.session_state and not st.session_state['customer_matches']:
            st.info("No matches found with the current threshold. Try lowering the minimum score.")
    else:
        st.warning("Need both Xero and historical customers to find matches.")

with data_mgmt_tabs[1]:
    st.subheader("Bulk Archive Old Data")
    st.markdown("""
    Archive customers and products that have no transactions after a specified date.
    Archived records won't appear in dashboard filters but data is preserved.
    """)

    col1, col2 = st.columns(2)
    with col1:
        archive_date = st.date_input(
            "Archive records with no activity after",
            value=pendulum.now().subtract(years=5).date(),
            help="Records with no transactions after this date will be archived"
        )

    with col2:
        if st.button("Preview Archive", key="preview_archive"):
            with get_connection() as conn:
                customers_to_archive = get_customers_to_archive(conn, str(archive_date))
                products_to_archive = get_products_to_archive(conn, str(archive_date))
            st.session_state['archive_preview'] = {
                'customers': customers_to_archive,
                'products': products_to_archive,
                'date': str(archive_date)
            }

    if 'archive_preview' in st.session_state:
        preview = st.session_state['archive_preview']
        customers_list = preview['customers']
        products_list = preview['products']

        st.info(f"**Preview Results** (no activity after {preview['date']}): {len(customers_list)} customers, {len(products_list)} products")

        # Customer archive section
        st.markdown("### Customers to Archive")
        if customers_list:
            cust_df = pd.DataFrame(customers_list)
            cust_df.columns = ['ID', 'Name', 'Market', 'Merchant Group']
            st.dataframe(cust_df[['Name', 'Market', 'Merchant Group']], use_container_width=True, height=200)

            # Allow excluding customers
            exclude_customers = st.multiselect(
                "Exclude customers from archive (they will NOT be archived)",
                options=[c['customer_id'] for c in customers_list],
                format_func=lambda cid: next((c['customer_name'] for c in customers_list if c['customer_id'] == cid), cid),
                key="exclude_customers"
            )

            customers_to_actually_archive = [c['customer_id'] for c in customers_list if c['customer_id'] not in exclude_customers]

            if st.button(f"Archive {len(customers_to_actually_archive)} Customers", type="primary", disabled=len(customers_to_actually_archive) == 0):
                with get_connection() as conn:
                    archived = archive_customers_by_ids(conn, customers_to_actually_archive)
                st.success(f"Archived {archived} customers")
                st.cache_data.clear()
                del st.session_state['archive_preview']
                st.rerun()
        else:
            st.success("No customers to archive for this date range.")

        st.markdown("---")

        # Product archive section
        st.markdown("### Products to Archive")
        if products_list:
            prod_df = pd.DataFrame(products_list)
            prod_df.columns = ['ID', 'Code', 'Name', 'Group']
            st.dataframe(prod_df[['Code', 'Name', 'Group']], use_container_width=True, height=200)

            # Allow excluding products
            exclude_products = st.multiselect(
                "Exclude products from archive (they will NOT be archived)",
                options=[p['product_id'] for p in products_list],
                format_func=lambda pid: next((f"{p['item_name']} ({p['product_code']})" for p in products_list if p['product_id'] == pid), str(pid)),
                key="exclude_products"
            )

            products_to_actually_archive = [p['product_id'] for p in products_list if p['product_id'] not in exclude_products]

            if st.button(f"Archive {len(products_to_actually_archive)} Products", type="primary", disabled=len(products_to_actually_archive) == 0):
                with get_connection() as conn:
                    archived = archive_products_by_ids(conn, products_to_actually_archive)
                st.success(f"Archived {archived} products")
                st.cache_data.clear()
                del st.session_state['archive_preview']
                st.rerun()
        else:
            st.success("No products to archive for this date range.")

        # Clear preview button
        if st.button("Clear Preview", key="clear_preview"):
            del st.session_state['archive_preview']
            st.rerun()

with data_mgmt_tabs[2]:
    st.subheader("View and Restore Archived Records")

    archived_type = st.radio("Record type", ["Customers", "Products"], horizontal=True)

    if archived_type == "Customers":
        # Fetch archived customers
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT customer_id, customer_name, market, merged_into, created_at
                    FROM dw.dim_customer
                    WHERE archived = true
                    ORDER BY customer_name
                """)
                archived_customers = cur.fetchall()

        if archived_customers:
            archived_df = pd.DataFrame(archived_customers)
            archived_df.columns = ['ID', 'Name', 'Market', 'Merged Into', 'Created']
            st.dataframe(archived_df, use_container_width=True)

            # Unarchive option
            selected_to_restore = st.selectbox(
                "Select customer to restore",
                options=[c['customer_id'] for c in archived_customers],
                format_func=lambda cid: next((c['customer_name'] for c in archived_customers if c['customer_id'] == cid), cid)
            )

            if st.button("Restore Selected Customer"):
                with get_connection() as conn:
                    if unarchive_customer(conn, selected_to_restore):
                        st.success("Customer restored successfully")
                        st.cache_data.clear()
                        st.rerun()
                    else:
                        st.error("Failed to restore customer")
        else:
            st.info("No archived customers found.")

    else:  # Products
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT product_id, product_code, item_name, product_group, created_at
                    FROM dw.dim_product
                    WHERE archived = true
                    ORDER BY item_name
                """)
                archived_products = cur.fetchall()

        if archived_products:
            archived_df = pd.DataFrame(archived_products)
            archived_df.columns = ['ID', 'Code', 'Name', 'Group', 'Created']
            st.dataframe(archived_df, use_container_width=True)

            # Unarchive option
            selected_to_restore = st.selectbox(
                "Select product to restore",
                options=[p['product_id'] for p in archived_products],
                format_func=lambda pid: next((f"{p['item_name']} ({p['product_code']})" for p in archived_products if p['product_id'] == pid), str(pid))
            )

            if st.button("Restore Selected Product"):
                with get_connection() as conn:
                    if unarchive_product(conn, selected_to_restore):
                        st.success("Product restored successfully")
                        st.cache_data.clear()
                        st.rerun()
                    else:
                        st.error("Failed to restore product")
        else:
            st.info("No archived products found.")


run_command = "streamlit run app/app.py"
st.sidebar.markdown("---")
st.sidebar.caption(f"To launch locally: `{run_command}`")
