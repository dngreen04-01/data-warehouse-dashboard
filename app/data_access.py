"""Database access helpers for the analytics/admin app."""

from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

import pandas as pd
import pendulum
from dotenv import load_dotenv
from psycopg import connect
from psycopg.rows import dict_row

load_dotenv()



def _read_dataframe(query: str, params: Iterable[Any] | None = None) -> pd.DataFrame:
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise RuntimeError("SUPABASE_CONNECTION_STRING is not configured")
    params = tuple(params or [])
    with connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            rows = cur.fetchall()
    return pd.DataFrame(rows, columns=columns)

def _safe_number(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        if isinstance(value, (int, float)):
            return float(value)
        numeric = pd.to_numeric(value, errors='coerce')
        if pd.isna(numeric):
            return 0.0
        return float(numeric)
    except Exception:  # noqa: BLE001
        return 0.0


@dataclass
class DateFilters:
    start_date: str | None
    end_date: str | None


@contextmanager
def get_connection():
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise RuntimeError("SUPABASE_CONNECTION_STRING is not configured")
    with connect(conn_str, row_factory=dict_row) as conn:
        yield conn


def fetch_reference_data() -> Dict[str, pd.DataFrame]:
    queries = {
        "customers": "select customer_id, customer_name, market, merchant_group from dw.dim_customer order by customer_name",
        "products": "select product_id, product_code, item_name, product_group from dw.dim_product order by item_name",
        "clusters": "select cluster_id, cluster_label from dw.dim_cluster order by cluster_id",
        "markets": "select distinct market from dw.dim_customer order by market",
        "merchant_groups": "select distinct merchant_group from dw.dim_customer where merchant_group is not null and merchant_group <> '' order by merchant_group"
    }
    frames: Dict[str, pd.DataFrame] = {}
    for key, query in queries.items():
        frames[key] = _read_dataframe(query)
    return frames


def build_where_clause(filters: Dict[str, Iterable[Any]], date_filters: DateFilters) -> tuple[str, List[Any]]:
    clauses: List[str] = []
    params: List[Any] = []
    for col, values in filters.items():
        value_list = [v for v in values if v not in (None, "All")]
        if value_list:
            placeholders = ",".join(["%s"] * len(value_list))
            clauses.append(f"{col} in ({placeholders})")
            params.extend(value_list)
    if date_filters.start_date:
        clauses.append("invoice_date >= %s")
        params.append(date_filters.start_date)
    if date_filters.end_date:
        clauses.append("invoice_date <= %s")
        params.append(date_filters.end_date)
    where_sql = " where " + " and ".join(clauses) if clauses else ""
    return where_sql, params


def fetch_sales_timeseries(filters: Dict[str, Iterable[Any]], date_filters: DateFilters) -> pd.DataFrame:
    where_sql, params = build_where_clause({
        "customer_id": filters.get("customer_id", []),
        "cluster_id": filters.get("cluster_id", []),
        "market": filters.get("market", []),
        "merchant_group": filters.get("merchant_group", []),
        "product_group": filters.get("product_group", []),
    }, date_filters)
    query = f"""
        select
            invoice_date,
            sum(line_amount) as revenue,
            sum(qty) as quantity
        from mart.sales_enriched
        {where_sql}
        group by invoice_date
        order by invoice_date
    """
    return _read_dataframe(query, params)


def fetch_comparison_metrics(current_end: pendulum.DateTime, filters: Dict[str, Iterable[Any]]) -> pd.DataFrame:
    """Return current vs prior-year metrics for WTD/MTD/YTD windows."""
    comparison_ranges = {
        'WTD': (current_end.start_of('week'), current_end),
        'MTD': (current_end.start_of('month'), current_end),
        'YTD': (current_end.start_of('year'), current_end),
    }
    records: List[Dict[str, Any]] = []

    for label, (start, end) in comparison_ranges.items():
        current_filters = DateFilters(start_date=start.to_date_string(), end_date=end.to_date_string())
        where_sql, params = build_where_clause({
            'customer_id': filters.get('customer_id', []),
            'cluster_id': filters.get('cluster_id', []),
            'market': filters.get('market', []),
            'merchant_group': filters.get('merchant_group', []),
            'product_group': filters.get('product_group', []),
        }, current_filters)
        current_query = f"""
            select
                coalesce(sum(line_amount), 0) as revenue,
                coalesce(sum(qty), 0) as quantity
            from mart.sales_enriched
            {where_sql}
        """
        current_df = _read_dataframe(current_query, params)
        current_row = current_df.iloc[0] if not current_df.empty else {}

        prev_start = start.subtract(years=1)
        prev_end = end.subtract(years=1)
        previous_filters = DateFilters(start_date=prev_start.to_date_string(), end_date=prev_end.to_date_string())
        prev_where, prev_params = build_where_clause({
            'customer_id': filters.get('customer_id', []),
            'cluster_id': filters.get('cluster_id', []),
            'market': filters.get('market', []),
            'merchant_group': filters.get('merchant_group', []),
            'product_group': filters.get('product_group', []),
        }, previous_filters)
        previous_query = f"""
            select
                coalesce(sum(line_amount), 0) as revenue,
                coalesce(sum(qty), 0) as quantity
            from mart.sales_enriched
            {prev_where}
        """
        previous_df = _read_dataframe(previous_query, prev_params)
        previous_row = previous_df.iloc[0] if not previous_df.empty else {}

        current_revenue = _safe_number(current_row.get('revenue'))
        previous_revenue = _safe_number(previous_row.get('revenue'))
        current_qty = _safe_number(current_row.get('quantity'))
        previous_qty = _safe_number(previous_row.get('quantity'))

        records.append({
            'period': label,
            'current_revenue': current_revenue,
            'previous_revenue': previous_revenue,
            'current_qty': current_qty,
            'previous_qty': previous_qty,
        })
    return pd.DataFrame(records)


def fetch_breakdown(dimension: str, filters: Dict[str, Iterable[Any]], date_filters: DateFilters) -> pd.DataFrame:
    allowed_dimensions = {
        "market": "market",
        "merchant_group": "merchant_group",
        "customer": "customer_name",
        "parent_customer": "merchant_group",
        "cluster": "cluster_label",
        "product_group": "product_group",
        "product": "item_name",
    }
    column = allowed_dimensions.get(dimension, dimension)
    where_sql, params = build_where_clause({
        "customer_id": filters.get("customer_id", []),
        "cluster_id": filters.get("cluster_id", []),
        "market": filters.get("market", []),
        "merchant_group": filters.get("merchant_group", []),
        "product_group": filters.get("product_group", []),
    }, date_filters)
    query = f"""
        select
            coalesce({column}, 'Unknown') as label,
            sum(line_amount) as revenue,
            sum(qty) as quantity
        from mart.sales_enriched
        {where_sql}
        group by 1
        order by revenue desc
    """
    return _read_dataframe(query, params)


def fetch_top_performers(dimension: str, filters: Dict[str, Iterable[Any]],
                         date_filters: DateFilters, limit: int = 10) -> pd.DataFrame:
    map_dimension = {
        "products": "item_name",
        "customers": "customer_name",
        "parent_customers": "merchant_group",
    }
    column = map_dimension[dimension]
    where_sql, params = build_where_clause({
        "customer_id": filters.get("customer_id", []),
        "cluster_id": filters.get("cluster_id", []),
        "market": filters.get("market", []),
        "merchant_group": filters.get("merchant_group", []),
        "product_group": filters.get("product_group", []),
    }, date_filters)
    query = f"""
        select
            coalesce({column}, 'Unknown') as label,
            sum(line_amount) as revenue,
            sum(qty) as quantity
        from mart.sales_enriched
        {where_sql}
        group by 1
        order by revenue desc
        limit {limit}
    """
    return _read_dataframe(query, params)




def fetch_year_over_year_breakdown(
    dimension: str,
    filters: Dict[str, Iterable[Any]],
    start_date: str | None,
    end_date: str | None,
    years: int = 4,
) -> pd.DataFrame:
    dimension_map = {
        'customer': 'customer_name',
        'merchant_group': 'merchant_group',
        'cluster': 'cluster_label',
        'market': 'market',
        'product': 'item_name',
        'product_group': 'product_group',
    }
    column = dimension_map.get(dimension)
    if column is None:
        raise ValueError(f"Unsupported dimension '{dimension}'")

    base_end = pendulum.parse(end_date) if end_date else pendulum.now('UTC')
    base_start = pendulum.parse(start_date) if start_date else base_end.start_of('year')

    if base_start > base_end:
        base_start, base_end = base_end.start_of('year'), base_end

    year_labels = ['TY', 'LY', 'LLY', 'LLLY'][:years]
    result: pd.DataFrame | None = None

    for offset, label in enumerate(year_labels):
        period_start = base_start.subtract(years=offset)
        period_end = base_end.subtract(years=offset)
        date_filters = DateFilters(period_start.to_date_string(), period_end.to_date_string())
        where_sql, params = build_where_clause({
            'customer_id': filters.get('customer_id', []),
            'cluster_id': filters.get('cluster_id', []),
            'market': filters.get('market', []),
            'merchant_group': filters.get('merchant_group', []),
            'product_group': filters.get('product_group', []),
            'product_id': filters.get('product_id', []),
        }, date_filters)
        query = f"""
            select
                coalesce({column}, 'Unknown') as label,
                coalesce(sum(line_amount), 0) as revenue
            from mart.sales_enriched
            {where_sql}
            group by 1
        """
        df = _read_dataframe(query, params)
        if df.empty:
            df = pd.DataFrame({'label': [], label: []})
        else:
            df[label] = df['revenue'].apply(_safe_number)
            df = df[['label', label]]

        if result is None:
            result = df
        else:
            result = result.merge(df, on='label', how='outer')

    if result is None:
        result = pd.DataFrame(columns=['label'] + year_labels)

    for label in year_labels:
        if label in result.columns:
            result[label] = result[label].apply(_safe_number)

    return result.fillna(0.0).sort_values(year_labels[0], ascending=False)



def fetch_cluster_members() -> pd.DataFrame:
    query = """
        select
            cl.cluster_id,
            cl.cluster_label,
            cust.customer_id,
            cust.customer_name
        from dw.dim_customer_cluster cl_map
        left join dw.dim_cluster cl on cl.cluster_id = cl_map.cluster_id
        left join dw.dim_customer cust on cust.customer_id = cl_map.customer_id
        order by cl.cluster_id, cust.customer_name
    """
    return _read_dataframe(query)

def fetch_transactions(filters: Dict[str, Iterable[Any]], date_filters: DateFilters) -> pd.DataFrame:
    where_sql, params = build_where_clause({
        "customer_id": filters.get("customer_id", []),
        "cluster_id": filters.get("cluster_id", []),
        "market": filters.get("market", []),
        "merchant_group": filters.get("merchant_group", []),
        "product_group": filters.get("product_group", []),
        "product_id": filters.get("product_id", []),
    }, date_filters)
    query = f"""
        select
            invoice_date,
            invoice_number,
            customer_name,
            merchant_group,
            market,
            item_name,
            product_group,
            qty,
            unit_price,
            line_amount,
            load_source
        from mart.sales_enriched
        {where_sql}
        order by invoice_date desc
        limit 2000
    """
    return _read_dataframe(query, params)


def upsert_customer(payload: Dict[str, Any]) -> None:
    columns = [
        "customer_id",
        "customer_name",
        "contact_name",
        "phone",
        "fax",
        "bill_to",
        "balance_total",
        "market",
        "merchant_group",
        "xero_account_number",
    ]
    values = [payload.get(col) for col in columns]
    placeholders = ",".join(["%s"] * len(columns))
    updates = ",".join([f"{col}=excluded.{col}" for col in columns if col != "customer_id"])
    sql_stmt = f"""
        insert into dw.dim_customer ({', '.join(columns)})
        values ({placeholders})
        on conflict (customer_id)
        do update set {updates}
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql_stmt, values)
            conn.commit()


def upsert_product(payload: Dict[str, Any]) -> None:
    columns = [
        "product_id",
        "product_code",
        "item_name",
        "item_description",
        "product_group",
        "price",
        "gross_price",
    ]
    values = [payload.get(col) for col in columns]
    placeholders = ",".join(["%s"] * len(columns))
    updates = ",".join([f"{col}=excluded.{col}" for col in columns if col != "product_id"])
    sql_stmt = f"""
        insert into dw.dim_product ({', '.join(columns)})
        values ({placeholders})
        on conflict (product_id)
        do update set {updates}
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql_stmt, values)
            conn.commit()


def next_customer_id() -> int:
    query = "select coalesce(max(customer_id::bigint), 0) + 1 as next_id from dw.dim_customer"
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
            return int(row["next_id"])


def next_product_id() -> int:
    query = "select coalesce(max(product_id), 0) + 1 as next_id from dw.dim_product"
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            row = cur.fetchone()
            return int(row["next_id"])

