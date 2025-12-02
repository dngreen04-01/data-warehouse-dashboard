from __future__ import annotations

import sys
from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd
import pendulum
import streamlit as st
from dotenv import load_dotenv

# Add app directory to path for imports when running from project root
sys.path.insert(0, str(Path(__file__).parent))

from data_access import (
    DateFilters,
    fetch_reference_data,
)

# Import Views
from views.dashboard import render_dashboard
from views.customers import render_customers
from views.products import render_products
from views.statements import render_statements

load_dotenv()

st.set_page_config(
    page_title="Unified Sales & Operations",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded"
)

# --- Shared Data Loading ---
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

# --- Filter Logic (Dashboard Only) ---
def serialize_filters(filters: Dict[str, List[str]]) -> Tuple[Tuple[str, Tuple[str, ...]], ...]:
    return tuple((key, tuple(sorted(values))) for key, values in sorted(filters.items()))

def render_dashboard_filters(reference_data: Dict[str, pd.DataFrame]) -> tuple[Dict[str, List[str]], DateFilters]:
    st.sidebar.markdown("---")
    st.sidebar.header("Dashboard Filters")

    date_default_end = pendulum.now("UTC").date()
    date_default_start = date_default_end.subtract(months=12)
    
    date_range = st.sidebar.date_input(
        "Date range",
        (date_default_start, date_default_end),
    )
    
    if isinstance(date_range, tuple) and len(date_range) == 2:
        start_date, end_date = date_range
    elif isinstance(date_range, tuple) and len(date_range) == 1:
         start_date = date_range[0]
         end_date = date_range[0]
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

    # Use Expanders for cleaner sidebar if there are many filters
    with st.sidebar.expander("Customer Filters", expanded=False):
        if not customers.empty:
            selected_customers = st.multiselect(
                "Customers",
                customers["customer_name"].tolist(),
            )
            if selected_customers:
                ids = customers.loc[customers["customer_name"].isin(selected_customers), "customer_id"].astype(str)
                filter_values["customer_id"] = ids.tolist()
        
        if merchant_groups is not None and not merchant_groups.empty:
            selected_parent = st.multiselect(
                "Parent Customers",
                merchant_groups["merchant_group"].dropna().tolist(),
            )
            if selected_parent:
                filter_values["merchant_group"] = selected_parent
                
        if clusters is not None and not clusters.empty:
            selected_clusters = st.multiselect(
                "Clusters",
                clusters["cluster_label"].tolist(),
            )
            if selected_clusters:
                ids = clusters.loc[clusters["cluster_label"].isin(selected_clusters), "cluster_id"].astype(int)
                filter_values["cluster_id"] = ids.tolist()
                
        if markets is not None and not markets.empty:
            selected_markets = st.multiselect(
                "Markets",
                markets["market"].dropna().tolist(),
            )
            if selected_markets:
                filter_values["market"] = selected_markets

    with st.sidebar.expander("Product Filters", expanded=False):
        if product_groups is not None and not product_groups.empty:
            selected_product_groups = st.multiselect(
                "Product Groups",
                product_groups["product_group"].fillna("Unknown").tolist(),
            )
            if selected_product_groups:
                filter_values["product_group"] = selected_product_groups
        
        if not products.empty:
            selected_products = st.multiselect(
                "Specific Products",
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

# --- Main App Layout ---
def main():
    try:
        reference_data = load_reference_tables()
    except Exception as e:
        st.error(f"Failed to load reference data: {e}")
        return

    st.sidebar.title("Navigation")
    
    # Sidebar Navigation with icons
    # Since we can't use extra libraries easily without installing, we stick to radio
    # But we format it nicely.
    view = st.sidebar.radio(
        "Go to", 
        ["Dashboard", "Customers", "Products", "Statements"],
        index=0
    )

    if view == "Dashboard":
        st.title("Unified Sales & Operations")
        filters, date_filters = render_dashboard_filters(reference_data)
        filters_serialized = serialize_filters(filters)
        current_end = pendulum.parse(date_filters.end_date) if date_filters.end_date else pendulum.now()
        
        render_dashboard(filters, date_filters, filters_serialized, current_end)

    elif view == "Customers":
        render_customers(reference_data)

    elif view == "Products":
        render_products(reference_data)
        
    elif view == "Statements":
        render_statements(reference_data)

    st.sidebar.markdown("---")
    st.sidebar.caption("Unified Warehouse v2.0")

if __name__ == "__main__":
    main()
