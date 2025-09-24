"""Load historical Reckon exports into Supabase (Postgres)"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

import pandas as pd
import pendulum
from dotenv import load_dotenv
from psycopg import connect
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT


def _normalize_customer_name(name: str) -> str:
    if not name:
        return ""
    normalized = name.lower().strip()
    normalized = normalized.replace('local - 1:', '')
    normalized = normalized.replace('local:', '')
    normalized = normalized.replace(':', ' - ')
    normalized = ' '.join(normalized.split())
    return normalized


@dataclass
class TableLoad:
    name: str
    csv_path: Path
    conflict_keys: Sequence[str]


def chunk_rows(rows: Iterable[Sequence], size: int = 1000) -> Iterable[List[Sequence]]:
    batch: List[Sequence] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def clean_customer_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["customer_id"] = df["customer_id"].astype(str)
    df["customer_name"] = df["customer_name"].str.strip()
    df["contact_name"] = df.get("contact_name").fillna("")
    for col in ("phone", "fax", "bill_to", "xero_account_number", "merchant_group"):
        if col in df.columns:
            df[col] = df[col].fillna("").astype(str).str.strip()
    df["balance_total"] = pd.to_numeric(df.get("balance_total"), errors="coerce").fillna(0).round(2)
    df["market"] = df.get("market", "Unknown").fillna("Unknown").replace({"": "Unknown"})
    return df[[
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
    ]]


def clean_product_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["item_name"] = df.get("item_name", "").fillna("")
    for numeric_col in ("price", "gross_price"):
        if numeric_col in df.columns:
            df[numeric_col] = pd.to_numeric(df[numeric_col], errors="coerce").fillna(0).round(2)
    df["product_group"] = df.get("product_group", "").fillna("Unknown")
    return df[[
        "product_id",
        "product_code",
        "item_name",
        "item_description",
        "product_group",
        "price",
        "gross_price",
    ]]


def clean_sales_line_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["customer_id"] = df["customer_id"].astype(str)
    df["invoice_date"] = df["invoice_date"].apply(lambda x: pendulum.parse(str(x)).date())
    for col in ("qty", "unit_price", "line_amount"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    df["load_source"] = "reckon_historical"
    df["product_code"] = pd.NA
    return df[[
        "invoice_number",
        "invoice_date",
        "document_type",
        "customer_id",
        "customer_name",
        "product_id",
        "product_code",
        "item_name",
        "qty",
        "unit_price",
        "line_amount",
        "load_source",
    ]]


def clean_invoice_frame(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["customer_id"] = df["customer_id"].astype(str)
    df["invoice_date"] = df["invoice_date"].apply(lambda x: pendulum.parse(str(x)).date())
    for col in ("lines", "net_amount"):
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df[[
        "invoice_number",
        "document_type",
        "invoice_date",
        "lines",
        "net_amount",
        "customer_id",
        "customer_name",
    ]]


def clean_cluster_frame(cluster_path: Path, summary_path: Path, customers: pd.DataFrame):
    raw_clusters = pd.read_csv(cluster_path)
    raw_clusters.columns = [c.strip().lower().replace("*","") for c in raw_clusters.columns]
    raw_clusters.rename(columns={
        "contactname": "customer_name",
        "accountnumber": "xero_account_number",
        "cluster": "cluster_id",
    }, inplace=True)
    raw_clusters["customer_name"] = raw_clusters["customer_name"].str.strip()
    raw_clusters["cluster_id"] = pd.to_numeric(raw_clusters["cluster_id"], errors="coerce").astype("Int64")
    raw_clusters["latitude"] = pd.to_numeric(raw_clusters.get("latitude"), errors="coerce")
    raw_clusters["longitude"] = pd.to_numeric(raw_clusters.get("longitude"), errors="coerce")

    customers = customers.copy()
    customers["xero_account_number"] = customers["xero_account_number"].fillna("").astype(str).str.strip()
    customers["normalized_name"] = customers["customer_name"].fillna("").apply(_normalize_customer_name)

    # Prefer smallest customer_id for each account number
    lookup_by_account = (
        customers[customers["xero_account_number"] != ""]
        .sort_values("customer_id")
        .drop_duplicates("xero_account_number", keep="first")
    )

    clusters = raw_clusters.merge(
        lookup_by_account[["customer_id", "customer_name", "xero_account_number"]],
        on="xero_account_number",
        how="left",
        suffixes=("", "_dim"),
    )

    if clusters["customer_id"].isna().any():
        # Fallback to fuzzy name match
        clusters["normalized_name"] = clusters["customer_name"].apply(_normalize_customer_name)
        name_lookup = customers[["customer_id", "customer_name", "normalized_name"]]
        clusters = clusters.merge(
            name_lookup,
            on="normalized_name",
            how="left",
            suffixes=("", "_name"),
        )
        clusters["customer_id"] = clusters["customer_id"].fillna(clusters["customer_id_name"])
        clusters["customer_name_dim"] = clusters["customer_name_dim"].fillna(clusters["customer_name_name"])

    clusters = clusters[clusters["customer_id"].notna()]
    clusters = clusters.rename(columns={"customer_name_dim": "matched_customer_name"})
    drop_cols = [col for col in ("customer_id_name", "customer_name_name", "normalized_name") if col in clusters.columns]
    clusters = clusters.drop(columns=drop_cols)
    clusters = clusters.drop_duplicates(['customer_id', 'cluster_id'])

    cluster_summary = pd.read_csv(summary_path)
    cluster_summary.columns = [c.strip().lower() for c in cluster_summary.columns]
    cluster_summary.rename(columns={
        "cluster": "cluster_id",
        "customercount": "customer_count",
        "examplecustomers": "example_customers",
    }, inplace=True)

    return clusters, cluster_summary


def load_dataframe(csv_path: Path, cleaner):
    df = cleaner(pd.read_csv(csv_path))
    df = df.where(pd.notnull(df), None)
    return df


def upsert_dataframe(conn, table_identifier: str, df: pd.DataFrame, conflict_keys: Sequence[str]):
    if df.empty:
        return 0
    columns = list(df.columns)
    data_rows = [tuple(row) for row in df.itertuples(index=False, name=None)]
    conflict_clause = sql.SQL(", ").join(sql.Identifier(c) for c in conflict_keys)
    set_clause = sql.SQL(", ").join(
        sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(col))
        for col in columns if col not in conflict_keys
    )
    placeholders = sql.SQL(', ').join(sql.Placeholder() for _ in columns)
    insert_stmt = sql.SQL("""
        INSERT INTO {table} ({columns})
        VALUES ({placeholders})
        ON CONFLICT ({conflict_clause}) DO UPDATE
        SET {set_clause}
    """).format(
        table=sql.SQL(table_identifier),
        columns=sql.SQL(', ').join(sql.Identifier(c) for c in columns),
        placeholders=placeholders,
        conflict_clause=conflict_clause,
        set_clause=set_clause,
    )

    total = 0
    with conn.cursor() as cur:
        query = insert_stmt.as_string(cur)
        for batch in chunk_rows(data_rows):
            cur.executemany(query, batch)
            total += len(batch)
    conn.commit()
    return total


def copy_clusters(conn, cluster_df: pd.DataFrame, summary_df: pd.DataFrame):
    cluster_payload = cluster_df[[
        "customer_id",
        "cluster_id",
        "latitude",
        "longitude",
    ]].copy()
    cluster_payload["cluster_name"] = cluster_payload["cluster_id"].apply(lambda cid: f"Cluster {cid}")
    cluster_payload = cluster_payload[[
        "customer_id",
        "cluster_id",
        "cluster_name",
        "latitude",
        "longitude",
    ]]

    summary_payload = summary_df[[
        "cluster_id",
        "customer_count",
        "example_customers",
    ]]
    summary_payload["cluster_label"] = summary_payload["cluster_id"].apply(lambda cid: f"Cluster {cid}")
    summary_payload["cluster_summary"] = summary_payload["example_customers"]

    upsert_dataframe(conn, "dw.dim_cluster", summary_payload, ("cluster_id",))
    upsert_dataframe(conn, "dw.dim_customer_cluster", cluster_payload, ("customer_id", "cluster_id"))


def log_run(conn, pipeline_name: str, status: str, processed_rows: int, error: str | None = None):
    with conn.cursor() as cur:
        cur.execute(
            "insert into dw.etl_run_log(pipeline_name, status, processed_rows, error_message) values (%s, %s, %s, %s)",
            (pipeline_name, status, processed_rows, error),
        )
    conn.commit()


def main():
    load_dotenv()
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise RuntimeError("SUPABASE_CONNECTION_STRING must be set in environment or .env file")

    conn = connect(conn_str, autocommit=False)

    loads = [
        TableLoad("dw.dim_customer", DATA_DIR / "dim_customer2.csv", ("customer_id",)),
        TableLoad("dw.dim_product", DATA_DIR / "dim_product4.csv", ("product_id",)),
        TableLoad("dw.fct_invoice", DATA_DIR / "fct_invoice_clean.csv", ("invoice_number", "invoice_date")),
        TableLoad("dw.fct_sales_line", DATA_DIR / "fct_sales_line_clean1.csv", ("invoice_number", "product_id", "item_name", "load_source")),
    ]

    total_rows = 0

    customer_df = None

    try:
        for load in loads:
            if load.name == "dw.dim_customer":
                df = load_dataframe(load.csv_path, clean_customer_frame)
                customer_df = df
            elif load.name == "dw.dim_product":
                df = load_dataframe(load.csv_path, clean_product_frame)
            elif load.name == "dw.fct_invoice":
                df = load_dataframe(load.csv_path, clean_invoice_frame)
            else:
                df = load_dataframe(load.csv_path, clean_sales_line_frame)

            processed = upsert_dataframe(conn, load.name, df, load.conflict_keys)
            total_rows += processed
            print(f"Loaded {processed} rows into {load.name}")

        if customer_df is None:
            raise RuntimeError("Customer dimension must be loaded before clusters")

        cluster_df, cluster_summary_df = clean_cluster_frame(
            DATA_DIR / "customer_clusters.csv",
            DATA_DIR / "Cluster_Summary.csv",
            customer_df,
        )
        copy_clusters(conn, cluster_df, cluster_summary_df)
        log_run(conn, "reckon_historical_load", "success", total_rows)
        print("Historical load completed successfully")

    except Exception as exc:  # noqa: BLE001
        conn.rollback()
        log_run(conn, "reckon_historical_load", "failed", total_rows, str(exc))
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
