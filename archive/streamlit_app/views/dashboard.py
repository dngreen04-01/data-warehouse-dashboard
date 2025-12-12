import streamlit as st
import pandas as pd
import plotly.express as px
import pendulum
from data_access import (
    fetch_comparison_metrics,
    fetch_breakdown,
    fetch_top_performers,
    fetch_year_over_year_breakdown,
    fetch_cluster_members,
    fetch_transactions,
    fetch_sales_timeseries,
    DateFilters
)

def render_dashboard(filters, date_filters, filters_serialized, current_end):
    """Renders the main dashboard view."""
    
    # --- KPIs ---
    st.subheader("Key Performance Indicators")
    
    # Fetch KPI data
    comparison_df = fetch_comparison_metrics(current_end, filters)
    
    if not comparison_df.empty:
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
    else:
        st.info("No KPI data available for the selected period.")

    st.markdown("---")

    # --- Sales Over Time Chart ---
    st.subheader("Sales Over Time")
    
    # We need to load time series here or pass it in. 
    # Since it's specific to this view, we load it here.
    # We can use the cache from app.py if we import the loader, or just call the data_access function directly.
    # Calling directly is fine as streamlit caches the data_access functions usually, 
    # but app.py had a wrapper. To keep it simple, we'll call the data access function directly 
    # but we need to match the signature expected by the data layer.
    
    filters_payload = {key: list(values) for key, values in filters_serialized}
    time_series = fetch_sales_timeseries(filters_payload, DateFilters(date_filters.start_date, date_filters.end_date))

    if time_series.empty:
        st.info("No sales data for the selected filters.")
    else:
        chart_df = time_series.copy()
        chart_df["invoice_date"] = pd.to_datetime(chart_df["invoice_date"], errors="coerce")
        chart_df = chart_df.dropna(subset=["invoice_date"]).sort_values("invoice_date")

        # Previous Year Comparison Logic
        chart_start = pendulum.parse(date_filters.start_date) if date_filters.start_date else current_end.subtract(months=12)
        prev_start = chart_start.subtract(years=1)
        prev_end = (pendulum.parse(date_filters.end_date) if date_filters.end_date else current_end).subtract(years=1)
        
        prev_series = fetch_sales_timeseries(
            filters_payload, 
            DateFilters(prev_start.to_date_string(), prev_end.to_date_string())
        )
        
        if not prev_series.empty:
            prev_series = prev_series.copy()
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
            labels={"value": "Revenue", "invoice_date": "Date", "variable": "Period"},
            title="Cumulative Revenue vs Prior Year",
            color_discrete_map={"TY Revenue": "#0068C9", "LY Revenue": "#83C9FF"}
        )
        fig.update_layout(
            legend=dict(title=None, orientation="h", y=1.02, yanchor="bottom", x=1, xanchor="right"),
            hovermode="x unified",
            xaxis_title="",
            yaxis_title="Revenue ($)"
        )
        st.plotly_chart(fig, use_container_width=True)

    # --- Breakdown Views ---
    st.markdown("### Breakdown Analysis")
    
    breakdown_tabs = st.tabs(["Market", "Parent Customer", "Product Group", "Cluster"])
    
    breakdown_configs = [
        ("market", "Revenue by Market", breakdown_tabs[0]),
        ("merchant_group", "Revenue by Parent Customer", breakdown_tabs[1]),
        ("product_group", "Revenue by Product Group", breakdown_tabs[2]),
        ("cluster", "Revenue by Customer Cluster", breakdown_tabs[3]),
    ]

    for dimension, title, tab in breakdown_configs:
        with tab:
            df = fetch_breakdown(dimension, filters, date_filters)
            if df.empty:
                st.info(f"No data for {title}.")
            else:
                fig = px.bar(
                    df.head(25), 
                    x="label", 
                    y="revenue", 
                    title=None,
                    color="revenue",
                    color_continuous_scale="Blues"
                )
                fig.update_layout(
                    xaxis_title="", 
                    yaxis_title="Revenue", 
                    xaxis_tickangle=-45,
                    coloraxis_showscale=False
                )
    st.plotly_chart(fig, width='stretch')

    # --- Top Performers ---
    st.markdown("### Top Performers")
    top_tabs = st.tabs(["Products", "Customers", "Parent Customers"])
    
    top_config = [
        ("products", top_tabs[0]),
        ("customers", top_tabs[1]),
        ("parent_customers", top_tabs[2]),
    ]
    
    for dimension, tab in top_config:
        with tab:
            df = fetch_top_performers(dimension, filters, date_filters)
            if df.empty:
                st.write("No data available")
            else:
                df = df.copy()
                if 'revenue' in df.columns:
                    df['revenue'] = pd.to_numeric(df['revenue'], errors='coerce').fillna(0.0)
                if 'quantity' in df.columns:
                    df['quantity'] = pd.to_numeric(df['quantity'], errors='coerce').fillna(0.0)
                
                st.dataframe(
                    df.style.format({"revenue": "${:,.0f}", "quantity": "{:,.0f}"}), 
                    use_container_width=True,
                    height=300
                )

    # --- YoY Analysis ---
    st.markdown("### Year-Over-Year Analysis")
    
    yoy_col1, yoy_col2 = st.columns(2)
    
    with yoy_col1:
        st.caption("Customer Performance")
        # Simplified YoY for Customers
        cust_yoy_df = fetch_year_over_year_breakdown(
            "customer", filters_payload, date_filters.start_date, date_filters.end_date
        )
        if not cust_yoy_df.empty:
             # Formatting
            display_df = cust_yoy_df.rename(columns={"label": "Customer"})
            cols_to_fmt = [c for c in ["TY", "LY"] if c in display_df.columns]
            if cols_to_fmt:
                for c in cols_to_fmt:
                    display_df[c] = pd.to_numeric(display_df[c], errors='coerce').fillna(0)
                
                display_df = display_df.sort_values("TY", ascending=False).head(50)
                st.dataframe(
                    display_df[["Customer"] + cols_to_fmt].style.format({c: "${:,.0f}" for c in cols_to_fmt}),
                    use_container_width=True,
                    height=300
                )
        else:
            st.info("No data")

    with yoy_col2:
        st.caption("Product Performance")
        # Simplified YoY for Products
        prod_yoy_df = fetch_year_over_year_breakdown(
            "product", filters_payload, date_filters.start_date, date_filters.end_date
        )
        if not prod_yoy_df.empty:
            display_df = prod_yoy_df.rename(columns={"label": "Product"})
            cols_to_fmt = [c for c in ["TY", "LY"] if c in display_df.columns]
            if cols_to_fmt:
                for c in cols_to_fmt:
                    display_df[c] = pd.to_numeric(display_df[c], errors='coerce').fillna(0)
                
                display_df = display_df.sort_values("TY", ascending=False).head(50)
                st.dataframe(
                    display_df[["Product"] + cols_to_fmt].style.format({c: "${:,.0f}" for c in cols_to_fmt}),
                    use_container_width=True,
                    height=300
                )
        else:
            st.info("No data")

    # --- Transactions ---
    with st.expander("View Detailed Transactions"):
        transactions = fetch_transactions(filters, date_filters)
        if transactions.empty:
            st.write("No transactions found.")
        else:
            st.dataframe(transactions, use_container_width=True)
            st.download_button(
                "Download CSV",
                data=transactions.to_csv(index=False).encode("utf-8"),
                file_name="transactions.csv",
                mime="text/csv",
            )
