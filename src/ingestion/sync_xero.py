"""Incremental sync of invoices and sales lines from Xero into Supabase."""

from __future__ import annotations

import logging
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

API_BASE = "https://api.xero.com/api.xro/2.0"
TOKEN_URL = "https://identity.xero.com/connect/token"


def parse_xero_date(date_str: str | None) -> date | None:
    """Parse Xero date format which can be ISO or Microsoft JSON format.

    Xero returns dates in formats like:
    - /Date(1355184000000+0000)/ (Microsoft JSON format - milliseconds since epoch)
    - 2023-01-15T00:00:00 (ISO format)
    """
    if not date_str:
        return None

    # Handle Microsoft JSON date format: /Date(1355184000000+0000)/
    if date_str.startswith('/Date('):
        import re
        match = re.search(r'/Date\((\d+)([+-]\d+)?\)/', date_str)
        if match:
            timestamp_ms = int(match.group(1))
            return pendulum.from_timestamp(timestamp_ms / 1000, tz='UTC').date()
        return None

    # Handle ISO format
    try:
        return pendulum.parse(date_str, strict=False).date()
    except Exception:
        return None


@dataclass
class XeroCredentials:
    client_id: str
    client_secret: str
    tenant_id: str
    scopes: str = "accounting.transactions.read accounting.contacts.read"


class XeroClient:
    """Xero API client using OAuth2 client credentials grant (machine-to-machine).

    This implementation uses client_id and client_secret only - no refresh token needed.
    Access tokens are cached in the database and automatically refreshed when expired.
    """

    def __init__(self, creds: XeroCredentials, conn):
        self.creds = creds
        self.conn = conn
        self.access_token: str | None = None
        self.token_expiry: datetime | None = None
        self.encryption_key = os.getenv("XERO_ENCRYPTION_KEY", "default-encryption-key-change-in-production")
        self._load_stored_tokens()

    def _get_encryption_key(self) -> str:
        """Get encryption key from environment, with warning if using default."""
        key = self.encryption_key
        if key == "default-encryption-key-change-in-production":
            logger.warning("Using default encryption key. Set XERO_ENCRYPTION_KEY environment variable for production.")
        return key

    def _encrypt_token(self, token: str) -> bytes:
        """Encrypt a token using pgcrypto."""
        with self.conn.cursor() as cur:
            cur.execute(
                "select pgp_sym_encrypt(%s, %s)",
                (token, self._get_encryption_key())
            )
            result = cur.fetchone()
            return result[0] if result else b''

    def _decrypt_token(self, encrypted_token: bytes) -> str:
        """Decrypt a token using pgcrypto."""
        with self.conn.cursor() as cur:
            cur.execute(
                "select pgp_sym_decrypt(%s, %s)",
                (encrypted_token, self._get_encryption_key())
            )
            result = cur.fetchone()
            if result and result[0]:
                # Handle both bytes and str return types
                token = result[0]
                return token.decode('utf-8') if isinstance(token, bytes) else token
            return ''

    def _load_stored_tokens(self):
        """Load cached access token from database if still valid."""
        try:
            with self.conn.cursor() as cur:
                # Only load tokens that haven't expired (with 5 minute buffer)
                cur.execute(
                    """
                    select access_token, token_expiry
                    from dw.xero_tokens
                    where tenant_id = %s
                    and token_expiry > timezone('utc', now()) + interval '5 minutes'
                    order by updated_at desc
                    limit 1
                    """,
                    (self.creds.tenant_id,)
                )
                row = cur.fetchone()
                if row:
                    logger.info("Loaded cached access token from database")
                    self.access_token = self._decrypt_token(row[0])
                    self.token_expiry = row[1]
                else:
                    logger.info("No valid cached token found, will request new access token")
        except Exception as e:
            logger.warning(f"Failed to load cached tokens: {e}. Will request new access token.")

    def _save_access_token(self, access_token: str, expires_in: int):
        """Save the access token to database with encryption."""
        try:
            self.access_token = access_token
            self.token_expiry = pendulum.now("UTC").add(seconds=expires_in)

            encrypted_access = self._encrypt_token(access_token)
            # For client credentials flow, we store a placeholder for refresh_token
            encrypted_placeholder = self._encrypt_token("client_credentials_grant")

            with self.conn.cursor() as cur:
                cur.execute(
                    """
                    insert into dw.xero_tokens (tenant_id, refresh_token, access_token, token_expiry)
                    values (%s, %s, %s, %s)
                    on conflict (tenant_id) do update
                    set refresh_token = excluded.refresh_token,
                        access_token = excluded.access_token,
                        token_expiry = excluded.token_expiry,
                        updated_at = timezone('utc', now())
                    """,
                    (self.creds.tenant_id, encrypted_placeholder, encrypted_access, self.token_expiry),
                )
            self.conn.commit()
            logger.info("Saved encrypted access token to database")
        except Exception as e:
            logger.error(f"Failed to save access token: {e}")
            self.conn.rollback()
            raise

    def _request_access_token(self) -> None:
        """Request a new access token using client credentials grant."""
        try:
            logger.info("Requesting new Xero access token via client credentials")
            response = requests.post(
                TOKEN_URL,
                data={
                    "grant_type": "client_credentials",
                    "scope": self.creds.scopes,
                },
                auth=(self.creds.client_id, self.creds.client_secret),
                timeout=30,
            )
            response.raise_for_status()

            payload = response.json()
            self._save_access_token(
                payload["access_token"],
                int(payload["expires_in"])
            )
            logger.info("Successfully obtained and saved access token")

        except requests.exceptions.HTTPError as e:
            logger.error(f"HTTP error requesting token: {e}")
            logger.error(f"Response status: {response.status_code}")
            logger.error(f"Response text: {response.text}")

            if response.status_code == 401:
                logger.error("Token request failed with 401 Unauthorized.")
                logger.error("Action required: Check XERO_CLIENT_ID and XERO_CLIENT_SECRET are correct.")
            elif response.status_code == 400:
                logger.error("Token request failed with 400 Bad Request.")
                logger.error("Action required: Verify scopes are valid and app has required permissions.")

            raise RuntimeError(f"Failed to obtain Xero access token: {e}") from e

        except requests.exceptions.RequestException as e:
            logger.error(f"Network error requesting token: {e}")
            raise RuntimeError(f"Network error during token request: {e}") from e

        except Exception as e:
            logger.error(f"Unexpected error requesting token: {e}")
            raise

    def _auth_header(self) -> dict:
        """Get authorization headers, requesting new token if needed."""
        if not self.access_token or (self.token_expiry and pendulum.now("UTC") >= self.token_expiry):
            self._request_access_token()
        assert self.access_token  # for type checkers
        return {
            "Authorization": f"Bearer {self.access_token}",
            "xero-tenant-id": self.creds.tenant_id,
            "Accept": "application/json",
        }

    def fetch_invoices(self, modified_since: pendulum.DateTime | None = None) -> List[dict]:
        """Fetch all invoices from Xero, paginating through all results.

        Xero returns 100 invoices per page. We keep fetching until we get
        fewer than 100 invoices, indicating we've reached the last page.
        """
        headers = self._auth_header()
        params = {"page": 1}
        if modified_since:
            headers["If-Modified-Since"] = modified_since.in_timezone('UTC').strftime('%a, %d %b %Y %H:%M:%S GMT')

        invoices: List[dict] = []
        page_size = 100  # Xero's default page size

        while True:
            logger.info(f"Fetching page {params['page']}...")
            response = requests.get(
                f"{API_BASE}/Invoices",
                headers=headers,
                params=params,
                timeout=60,  # Increased timeout for large responses
            )
            response.raise_for_status()
            batch = response.json().get("Invoices", [])
            invoices.extend(batch)
            logger.info(f"Page {params['page']}: retrieved {len(batch)} invoices (total so far: {len(invoices)})")

            # Xero returns up to 100 invoices per page
            # If we get fewer than 100, we've reached the last page
            if len(batch) < page_size:
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




def ensure_customers(conn, invoice_df: pd.DataFrame, lines_df: pd.DataFrame) -> None:
    """Ensure all customers from invoices exist in dim_customer.

    Also determines customer_type based on document_type:
    - ACCPAY (bills) -> supplier
    - ACCREC/Tax Invoice (sales invoices) -> customer
    - Both -> both
    """
    if invoice_df.empty:
        return

    # Get unique customers from invoices with their document types
    customers = invoice_df[['customer_id', 'customer_name', 'document_type']].drop_duplicates()
    customers = customers[customers['customer_id'].notna()]

    if customers.empty:
        return

    # Determine customer_type for each contact based on their invoice types
    customer_types = {}
    for customer_id in customers['customer_id'].unique():
        doc_types = set(customers[customers['customer_id'] == customer_id]['document_type'].unique())
        is_supplier = 'ACCPAY' in doc_types
        is_customer = bool(doc_types - {'ACCPAY'})  # Any non-ACCPAY type means customer

        if is_supplier and is_customer:
            customer_types[customer_id] = 'both'
        elif is_supplier:
            customer_types[customer_id] = 'supplier'
        else:
            customer_types[customer_id] = 'customer'

    # Check which customers already exist
    customer_ids = customers['customer_id'].tolist()
    with conn.cursor() as cur:
        # Use ANY() for array comparison in psycopg3
        cur.execute("SELECT customer_id, customer_type FROM dw.dim_customer WHERE customer_id = ANY(%s)", (customer_ids,))
        existing = {row[0]: row[1] for row in cur.fetchall()}

    # Get unique customer info for inserts/updates
    unique_customers = customers.drop_duplicates(subset=['customer_id'])[['customer_id', 'customer_name']]

    # Insert missing customers
    missing = unique_customers[~unique_customers['customer_id'].isin(existing.keys())]
    if not missing.empty:
        logger.info(f"Auto-creating {len(missing)} customers from Xero")
        with conn.cursor() as cur:
            for _, row in missing.iterrows():
                cust_type = customer_types.get(row['customer_id'], 'customer')
                cur.execute(
                    """
                    INSERT INTO dw.dim_customer (customer_id, customer_name, customer_type)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (customer_id) DO NOTHING
                    """,
                    (row['customer_id'], row['customer_name'] or 'Unknown Customer', cust_type)
                )

    # Update existing customers if their type needs to change (e.g., customer becomes 'both')
    for customer_id, new_type in customer_types.items():
        if customer_id in existing:
            old_type = existing[customer_id]
            # Upgrade to 'both' if they were customer and now have bills, or supplier and now have invoices
            if old_type != new_type and old_type != 'both':
                if (old_type == 'customer' and new_type == 'supplier') or \
                   (old_type == 'supplier' and new_type == 'customer'):
                    # They now have both types
                    with conn.cursor() as cur:
                        cur.execute(
                            "UPDATE dw.dim_customer SET customer_type = 'both' WHERE customer_id = %s",
                            (customer_id,)
                        )
                        logger.info(f"Updated {customer_id} customer_type to 'both'")

    conn.commit()


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

def extract_dataframes(invoices: List[dict]) -> Tuple[pd.DataFrame, pd.DataFrame, List[str]]:
    """Extract invoice and line dataframes, plus list of voided/deleted invoice numbers.

    Returns:
        Tuple of (invoice_df, lines_df, voided_invoice_numbers)
    """
    invoice_rows = []
    line_rows = []
    voided_invoices = []

    for inv in invoices:
        # Xero Status values: DRAFT, SUBMITTED, AUTHORISED, PAID, VOIDED, DELETED
        status = inv.get("Status", "UNKNOWN")
        invoice_number = inv.get("InvoiceNumber")

        # Track voided/deleted invoices for removal
        if status.upper() in ("VOIDED", "DELETED"):
            if invoice_number:
                voided_invoices.append(invoice_number)
            continue  # Skip adding to dataframes

        # Payment status tracking
        amount_due = inv.get("AmountDue", 0) or 0
        total = inv.get("Total", 0) or 0
        amount_paid = total - amount_due

        invoice_date = parse_xero_date(inv.get("Date"))

        invoice_rows.append(
            {
                "invoice_number": invoice_number,
                "document_type": inv.get("Type"),
                "invoice_date": invoice_date,
                "lines": len(inv.get("LineItems", [])),
                "net_amount": total,
                "customer_id": inv.get("Contact", {}).get("ContactID"),
                "customer_name": inv.get("Contact", {}).get("Name"),
                "status": status,
                "amount_due": amount_due,
                "amount_paid": amount_paid,
                "load_source": "xero_api",
            }
        )
        for line in inv.get("LineItems", []):
            line_rows.append(
                {
                    "invoice_number": invoice_number,
                    "invoice_date": invoice_date,
                    "document_type": inv.get("Type"),
                    "customer_id": inv.get("Contact", {}).get("ContactID"),
                    "customer_name": inv.get("Contact", {}).get("Name"),
                    "product_id": None,
                    "product_code": line.get("ItemCode"),
                    "item_name": line.get("Description"),
                    "account_code": line.get("AccountCode"),
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
        for col in ("net_amount", "qty", "unit_price", "line_amount", "amount_due", "amount_paid"):
            if col in frame.columns:
                frame[col] = pd.to_numeric(frame[col], errors="coerce").fillna(0)
    return invoice_df, line_df, voided_invoices


def delete_voided_invoices(conn, invoice_numbers: List[str]) -> int:
    """Delete voided/deleted invoices and their associated sales lines.

    Args:
        conn: Database connection
        invoice_numbers: List of invoice numbers to delete

    Returns:
        Number of invoices deleted
    """
    if not invoice_numbers:
        return 0

    deleted_count = 0
    with conn.cursor() as cur:
        # Delete sales lines first (child records)
        cur.execute(
            "DELETE FROM dw.fct_sales_line WHERE invoice_number = ANY(%s)",
            (invoice_numbers,)
        )
        lines_deleted = cur.rowcount
        logger.info(f"Deleted {lines_deleted} sales lines for voided/deleted invoices")

        # Delete invoices
        cur.execute(
            "DELETE FROM dw.fct_invoice WHERE invoice_number = ANY(%s)",
            (invoice_numbers,)
        )
        deleted_count = cur.rowcount
        logger.info(f"Deleted {deleted_count} voided/deleted invoices")

    return deleted_count


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


def validate_connection_string(conn_str: str) -> None:
    """Validate and log connection string details (without exposing secrets)."""
    from urllib.parse import urlparse

    if not conn_str:
        return

    try:
        parsed = urlparse(conn_str)
        logger.info(f"Database host: {parsed.hostname}")
        logger.info(f"Database port: {parsed.port or 5432}")
        logger.info(f"Database name: {parsed.path.lstrip('/')}")

        # Warn about potential IPv6 issues
        if parsed.port == 5432:
            logger.warning(
                "Using direct connection (port 5432). "
                "If running in GitHub Actions, consider using pooler URL (port 6543) for IPv4 compatibility."
            )
    except Exception as e:
        logger.warning(f"Could not parse connection string: {e}")


def main():
    """Main entry point for Xero sync process."""
    load_dotenv(override=True)

    logger.info("Starting Xero sync process")
    logger.info(f"Python version: {sys.version.split()[0]}")

    # Validate environment variables
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    validate_connection_string(conn_str)

    creds = XeroCredentials(
        client_id=os.getenv("XERO_CLIENT_ID", ""),
        client_secret=os.getenv("XERO_CLIENT_SECRET", ""),
        tenant_id=os.getenv("XERO_TENANT_ID", ""),
        scopes=os.getenv("XERO_SCOPES", "accounting.transactions.read accounting.contacts.read"),
    )

    if not conn_str:
        logger.error("SUPABASE_CONNECTION_STRING environment variable is not set")
        raise RuntimeError("SUPABASE_CONNECTION_STRING must be configured")

    if not all([creds.client_id, creds.client_secret, creds.tenant_id]):
        logger.error("Xero API credentials are incomplete")
        logger.error("Required: XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_TENANT_ID")
        raise RuntimeError("Xero API credentials are not fully configured")

    conn = None
    try:
        # Connect to database
        conn = connect(conn_str, autocommit=False)
        logger.info("Connected to database")

        # Initialize Xero client (will load tokens from DB if available)
        client = XeroClient(creds, conn)

        # Get last sync timestamp
        modified_since = get_last_sync(conn)
        if modified_since:
            logger.info(f"Fetching invoices modified since {modified_since}")
        else:
            logger.info("Fetching all invoices (first sync)")

        # Fetch invoices from Xero
        invoices = client.fetch_invoices(modified_since)
        logger.info(f"Retrieved {len(invoices)} invoices from Xero")

        if not invoices:
            logger.info("No new invoices to process")
            # Log successful run even if no data
            with conn.cursor() as cur:
                cur.execute(
                    "insert into dw.etl_run_log(pipeline_name, status, processed_rows) values (%s, %s, %s)",
                    ("xero_sync", "success", 0),
                )
            conn.commit()
            return

        # Extract and transform data
        invoice_df, lines_df, voided_invoices = extract_dataframes(invoices)
        logger.info(f"Extracted {len(invoice_df)} invoices and {len(lines_df)} line items")
        if voided_invoices:
            logger.info(f"Found {len(voided_invoices)} voided/deleted invoices to remove")

        # Ensure customers exist before inserting invoices
        ensure_customers(conn, invoice_df, lines_df)

        # Map product references
        lines_df = map_product_references(conn, lines_df)

        # Begin transaction for data upsert
        try:
            # Delete voided/deleted invoices first
            deleted_count = delete_voided_invoices(conn, voided_invoices)

            # Upsert data
            processed = 0
            invoice_count = upsert_dataframe(conn, "dw.fct_invoice", invoice_df, ("invoice_number", "invoice_date"))
            processed += invoice_count
            logger.info(f"Upserted {invoice_count} invoices")

            lines_count = upsert_dataframe(conn, "dw.fct_sales_line", lines_df, ("invoice_number", "product_id", "item_name", "load_source"))
            processed += lines_count
            logger.info(f"Upserted {lines_count} sales lines")

            # Update sync state
            last_invoice_date = None
            if not invoice_df.empty and "invoice_date" in invoice_df.columns:
                date_series = invoice_df["invoice_date"].dropna()
                if not date_series.empty:
                    last_invoice_date = date_series.max()
                    logger.info(f"Last invoice date: {last_invoice_date}")

            update_sync_state(conn, last_invoice_date)

            # Log successful run
            with conn.cursor() as cur:
                cur.execute(
                    "insert into dw.etl_run_log(pipeline_name, status, processed_rows, finished_at) values (%s, %s, %s, timezone('utc', now()))",
                    ("xero_sync", "success", processed),
                )
            conn.commit()
            logger.info(f"Sync completed successfully. Processed {processed} total rows, deleted {deleted_count} voided/deleted invoices.")

        except Exception as e:
            logger.error(f"Error during data processing: {e}")
            conn.rollback()

            # Log failed run
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "insert into dw.etl_run_log(pipeline_name, status, processed_rows, error_message, finished_at) values (%s, %s, %s, %s, timezone('utc', now()))",
                        ("xero_sync", "failed", 0, str(e)),
                    )
                conn.commit()
            except Exception as log_error:
                logger.error(f"Failed to log error: {log_error}")

            raise

    except Exception as e:
        logger.error(f"Fatal error in Xero sync: {e}", exc_info=True)
        raise

    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed")


def cleanup_voided_invoices():
    """One-time cleanup to remove all voided/deleted invoices from the database.

    This fetches ALL invoices from Xero (ignoring modified_since) and removes
    any that have VOIDED or DELETED status from the local database.
    """
    load_dotenv(override=True)

    logger.info("Starting one-time cleanup of voided/deleted invoices")

    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    creds = XeroCredentials(
        client_id=os.getenv("XERO_CLIENT_ID", ""),
        client_secret=os.getenv("XERO_CLIENT_SECRET", ""),
        tenant_id=os.getenv("XERO_TENANT_ID", ""),
        scopes=os.getenv("XERO_SCOPES", "accounting.transactions.read accounting.contacts.read"),
    )

    if not conn_str:
        logger.error("SUPABASE_CONNECTION_STRING environment variable is not set")
        raise RuntimeError("SUPABASE_CONNECTION_STRING must be configured")

    if not all([creds.client_id, creds.client_secret, creds.tenant_id]):
        logger.error("Xero API credentials are incomplete")
        raise RuntimeError("Xero API credentials are not fully configured")

    conn = None
    try:
        conn = connect(conn_str, autocommit=False)
        logger.info("Connected to database")

        client = XeroClient(creds, conn)

        # Fetch invoices from September 2025 onwards
        cleanup_since = pendulum.datetime(2025, 9, 1, tz='UTC')
        logger.info(f"Fetching invoices from Xero since {cleanup_since.to_date_string()} for cleanup...")
        invoices = client.fetch_invoices(modified_since=cleanup_since)
        logger.info(f"Retrieved {len(invoices)} total invoices from Xero")

        # Find voided/deleted invoices
        voided_invoices = []
        for inv in invoices:
            invoice_status = inv.get("Status", "").upper()
            invoice_number = inv.get("InvoiceNumber")
            if invoice_status in ("VOIDED", "DELETED") and invoice_number:
                voided_invoices.append(invoice_number)
                logger.debug(f"Found {invoice_status} invoice: {invoice_number}")

        logger.info(f"Found {len(voided_invoices)} voided/deleted invoices to remove")

        if voided_invoices:
            deleted_count = delete_voided_invoices(conn, voided_invoices)
            conn.commit()
            logger.info(f"Cleanup complete. Removed {deleted_count} voided/deleted invoices from database.")
        else:
            logger.info("No voided/deleted invoices found. Database is clean.")

    except Exception as e:
        logger.error(f"Error during cleanup: {e}", exc_info=True)
        if conn:
            conn.rollback()
        raise

    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--cleanup":
        cleanup_voided_invoices()
    else:
        main()
