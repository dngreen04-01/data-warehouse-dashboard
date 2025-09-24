"""Incremental sync of invoices and sales lines from Xero into Supabase."""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from typing import List, Tuple

import pandas as pd
import pendulum
import requests
from dotenv import load_dotenv
from psycopg import connect
from psycopg import sql

API_BASE = "https://api.xero.com/api.xro/2.0"
TOKEN_URL = "https://identity.xero.com/connect/token"


@dataclass
class XeroCredentials:
    client_id: str
    client_secret: str
    refresh_token: str
    tenant_id: str


class XeroClient:
    def __init__(self, creds: XeroCredentials):
        self.creds = creds
        self.access_token: str | None = None
        self.token_expiry: datetime | None = None

    def _refresh_access_token(self) -> None:
        response = requests.post(
            TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": self.creds.refresh_token,
            },
            auth=(self.creds.client_id, self.creds.client_secret),
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        self.access_token = payload["access_token"]
        self.token_expiry = pendulum.now("UTC").add(seconds=int(payload["expires_in"]))

    def _auth_header(self) -> dict:
        if not self.access_token or (self.token_expiry and pendulum.now("UTC") >= self.token_expiry):
            self._refresh_access_token()
        assert self.access_token  # for type checkers
        return {
            "Authorization": f"Bearer {self.access_token}",
            "xero-tenant-id": self.creds.tenant_id,
            "Accept": "application/json",
        }

    def fetch_invoices(self, modified_since: pendulum.DateTime | None = None) -> List[dict]:
        headers = self._auth_header()
        params = {"page": 1}
        if modified_since:
            headers["If-Modified-Since"] = modified_since.in_timezone('UTC').strftime('%a, %d %b %Y %H:%M:%S GMT')

        invoices: List[dict] = []
        while True:
            response = requests.get(
                f"{API_BASE}/Invoices",
                headers=headers,
                params=params,
                timeout=30,
            )
            response.raise_for_status()
            batch = response.json().get("Invoices", [])
            invoices.extend(batch)
            if not response.json().get("HasMorePages"):
                break
            params["page"] += 1
        return invoices


def upsert_dataframe(conn, table_identifier: str, frame: pd.DataFrame, conflict_cols: Tuple[str, ...]):
    if frame.empty:
        return 0
    columns = list(frame.columns)
    payload = [tuple(row) for row in frame.itertuples(index=False, name=None)]
    conflict_clause = sql.SQL(", ").join(sql.Identifier(c) for c in conflict_cols)
    set_clause = sql.SQL(", ").join(
        sql.SQL("{col} = EXCLUDED.{col}").format(col=sql.Identifier(col))
        for col in columns if col not in conflict_cols
    )
    placeholders = sql.SQL(', ').join(sql.Placeholder() for _ in columns)
    insert_stmt = sql.SQL("""
        INSERT INTO {table} ({columns})
        VALUES ({placeholders})
        ON CONFLICT ({conflict_clause}) DO UPDATE SET {set_clause}
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
        for start in range(0, len(payload), 500):
            batch = payload[start : start + 500]
            cur.executemany(query, batch)
            total += len(batch)
    conn.commit()
    return total




def map_product_references(conn, lines_df: pd.DataFrame) -> pd.DataFrame:
    if lines_df.empty:
        return lines_df
    lines_df = lines_df.copy()

    def normalize_code(value: str | None) -> str:
        return (value or '').strip()

    def normalize_name(value: str | None) -> str:
        return (value or '').strip().lower()

    with conn.cursor() as cur:
        cur.execute("select product_id, product_code, item_name from dw.dim_product")
        records = cur.fetchall()

    code_map = {normalize_code(row[1]): row[0] for row in records if row[1]}
    name_map = {normalize_name(row[2]): row[0] for row in records if row[2]}

    for idx, row in lines_df.iterrows():
        code_key = normalize_code(row.get('product_code'))
        name_key = normalize_name(row.get('item_name'))
        if code_key and code_key in code_map:
            lines_df.at[idx, 'product_id'] = code_map[code_key]
        elif name_key and name_key in name_map:
            lines_df.at[idx, 'product_id'] = name_map[name_key]

    missing_mask = lines_df['product_id'].isna()

    if missing_mask.any():
        lines_df = ensure_products(conn, lines_df, missing_mask, normalize_code, normalize_name)

    return lines_df


def ensure_products(conn, lines_df: pd.DataFrame, missing_mask: pd.Series, normalize_code, normalize_name):
    missing = lines_df[missing_mask].copy()
    if missing.empty:
        return lines_df

    combos: dict[tuple[str, str], dict] = {}
    for _, row in missing.iterrows():
        code_key = normalize_code(row.get('product_code'))
        name_key = normalize_name(row.get('item_name'))
        combos.setdefault((code_key, name_key), {
            'raw_code': row.get('product_code'),
            'raw_name': row.get('item_name'),
            'unit_price': row.get('unit_price'),
            'line_amount': row.get('line_amount'),
        })

    if not combos:
        return lines_df

    with conn.cursor() as cur:
        cur.execute("select coalesce(max(product_id), 0) from dw.dim_product")
        max_id = cur.fetchone()[0] or 0

    new_records = []
    mapping: dict[tuple[str, str], tuple[int, str]] = {}
    for key, values in combos.items():
        max_id += 1
        product_code = (values.get('raw_code') or '').strip() or f"AUTO-{max_id}"
        product_name = (values.get('raw_name') or '').strip() or f"Imported Product {max_id}"
        new_records.append({
            'product_id': max_id,
            'product_code': product_code,
            'item_name': product_name,
            'item_description': values.get('raw_name') or '',
            'product_group': 'Xero Imported',
            'price': values.get('unit_price') or 0,
            'gross_price': values.get('line_amount') or 0,
        })
        mapping[key] = (max_id, product_code)

    if new_records:
        frame = pd.DataFrame(new_records)
        upsert_dataframe(conn, 'dw.dim_product', frame, ('product_id',))

    for idx, row in lines_df[missing_mask].iterrows():
        code_key = normalize_code(row.get('product_code'))
        name_key = normalize_name(row.get('item_name'))
        match = mapping.get((code_key, name_key)) or mapping.get(('', name_key))
        if match:
            product_id, product_code = match
            lines_df.at[idx, 'product_id'] = product_id
            lines_df.at[idx, 'product_code'] = product_code

    return lines_df

def extract_dataframes(invoices: List[dict]) -> Tuple[pd.DataFrame, pd.DataFrame]:
    invoice_rows = []
    line_rows = []
    for inv in invoices:
        invoice_rows.append(
            {
                "invoice_number": inv.get("InvoiceNumber"),
                "document_type": inv.get("Type"),
                "invoice_date": pendulum.parse(inv.get("Date"), strict=False).date() if inv.get("Date") else None,
                "lines": len(inv.get("LineItems", [])),
                "net_amount": inv.get("Total"),
                "customer_id": inv.get("Contact", {}).get("ContactID"),
                "customer_name": inv.get("Contact", {}).get("Name"),
            }
        )
        for line in inv.get("LineItems", []):
            line_rows.append(
                {
                    "invoice_number": inv.get("InvoiceNumber"),
                    "invoice_date": pendulum.parse(inv.get("Date"), strict=False).date() if inv.get("Date") else None,
                    "document_type": inv.get("Type"),
                    "customer_id": inv.get("Contact", {}).get("ContactID"),
                    "customer_name": inv.get("Contact", {}).get("Name"),
                    "product_id": None,
                    "product_code": line.get("ItemCode"),
                    "item_name": line.get("Description"),
                    "qty": line.get("Quantity"),
                    "unit_price": line.get("UnitAmount"),
                    "line_amount": line.get("LineAmount"),
                    "load_source": "xero_api",
                }
            )
    invoice_df = pd.DataFrame(invoice_rows)
    line_df = pd.DataFrame(line_rows)
    for frame in (invoice_df, line_df):
        if frame.empty:
            continue
        for col in ("net_amount", "qty", "unit_price", "line_amount"):
            if col in frame.columns:
                frame[col] = pd.to_numeric(frame[col], errors="coerce").fillna(0)
        if "invoice_date" in frame.columns:
            frame["invoice_date"] = frame["invoice_date"].apply(
                lambda x: pendulum.parse(str(x), strict=False).date() if pd.notna(x) else None
            )
    return invoice_df, line_df


def get_last_sync(conn) -> pendulum.DateTime | None:
    with conn.cursor() as cur:
        cur.execute("select last_invoice_date from dw.sync_state where pipeline_name = %s", ("xero_sync",))
        row = cur.fetchone()
        if row and row[0]:
            return pendulum.datetime(row[0].year, row[0].month, row[0].day, tz='UTC')
    return None


def update_sync_state(conn, invoice_date: date | None):
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into dw.sync_state (pipeline_name, last_success_at, last_invoice_date)
            values (%s, timezone('utc', now()), %s)
            on conflict (pipeline_name)
            do update set last_success_at = excluded.last_success_at, last_invoice_date = excluded.last_invoice_date
            """,
            ("xero_sync", invoice_date),
        )
    conn.commit()


def main():
    load_dotenv()
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    creds = XeroCredentials(
        client_id=os.getenv("XERO_CLIENT_ID", ""),
        client_secret=os.getenv("XERO_CLIENT_SECRET", ""),
        refresh_token=os.getenv("XERO_REFRESH_TOKEN", ""),
        tenant_id=os.getenv("XERO_TENANT_ID", ""),
    )
    if not conn_str:
        raise RuntimeError("SUPABASE_CONNECTION_STRING must be configured")
    if not all([creds.client_id, creds.client_secret, creds.refresh_token, creds.tenant_id]):
        raise RuntimeError("Xero API credentials are not fully configured")

    conn = connect(conn_str, autocommit=False)
    client = XeroClient(creds)

    modified_since = get_last_sync(conn)
    invoices = client.fetch_invoices(modified_since)
    invoice_df, lines_df = extract_dataframes(invoices)
    lines_df = map_product_references(conn, lines_df)

    processed = 0
    processed += upsert_dataframe(conn, "dw.fct_invoice", invoice_df, ("invoice_number", "invoice_date"))
    processed += upsert_dataframe(conn, "dw.fct_sales_line", lines_df, ("invoice_number", "product_id", "item_name", "load_source"))

    last_invoice_date = None
    if not invoice_df.empty and "invoice_date" in invoice_df.columns:
        date_series = invoice_df["invoice_date"].dropna()
        if not date_series.empty:
            last_invoice_date = date_series.max()
    update_sync_state(conn, last_invoice_date)

    with conn.cursor() as cur:
        cur.execute(
            "insert into dw.etl_run_log(pipeline_name, status, processed_rows) values (%s, %s, %s)",
            ("xero_sync", "success", processed),
        )
    conn.commit()
    conn.close()


if __name__ == "__main__":
    main()
