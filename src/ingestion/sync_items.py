"""Sync Xero Items (inventory) data to dim_product table."""

from __future__ import annotations

import logging
import os
import sys
from typing import List

import pandas as pd
import requests
from dotenv import load_dotenv
from psycopg import connect

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

API_BASE = "https://api.xero.com/api.xro/2.0"

# Import shared components from sync_xero
from src.ingestion.sync_xero import XeroCredentials, XeroClient, upsert_dataframe


def fetch_items(client: XeroClient) -> List[dict]:
    """Fetch all items from Xero Items API.

    Unlike Invoices, Items endpoint returns all items in a single response
    (no pagination required for typical item counts).
    """
    headers = client._auth_header()

    logger.info("Fetching items from Xero...")
    response = requests.get(
        f"{API_BASE}/Items",
        headers=headers,
        timeout=60,
    )
    response.raise_for_status()

    items = response.json().get("Items", [])
    logger.info(f"Retrieved {len(items)} items from Xero")

    return items


def transform_items(items: List[dict]) -> pd.DataFrame:
    """Transform Xero Items to DataFrame matching dim_product schema."""
    rows = []

    for item in items:
        # Extract nested PurchaseDetails
        purchase_details = item.get("PurchaseDetails", {})
        purchase_unit_price = purchase_details.get("UnitPrice")
        cogs_account_code = purchase_details.get("COGSAccountCode")
        # Untracked items use AccountCode instead of COGSAccountCode
        if not cogs_account_code:
            cogs_account_code = purchase_details.get("AccountCode")

        # Extract nested SalesDetails
        sales_details = item.get("SalesDetails", {})
        sales_unit_price = sales_details.get("UnitPrice")
        sales_account_code = sales_details.get("AccountCode")

        rows.append({
            "xero_item_id": item.get("ItemID"),
            "product_code": item.get("Code"),
            "item_name": item.get("Name") or item.get("Description"),
            "item_description": item.get("Description"),
            "is_tracked_as_inventory": item.get("IsTrackedAsInventory", False),
            "inventory_asset_account_code": item.get("InventoryAssetAccountCode"),
            "total_cost_pool": item.get("TotalCostPool"),
            "quantity_on_hand": item.get("QuantityOnHand"),
            "purchase_unit_price": purchase_unit_price,
            "cogs_account_code": cogs_account_code,
            "price": sales_unit_price,
            "sales_account_code": sales_account_code,
        })

    df = pd.DataFrame(rows)

    # Convert numeric columns
    for col in ("total_cost_pool", "quantity_on_hand", "purchase_unit_price", "price"):
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Convert boolean
    if "is_tracked_as_inventory" in df.columns:
        df["is_tracked_as_inventory"] = df["is_tracked_as_inventory"].fillna(False).astype(bool)

    return df


def sync_items_to_products(conn, items_df: pd.DataFrame) -> int:
    """Sync items DataFrame to dim_product table.

    Strategy:
    1. Match by product_code (Xero Code)
    2. Update existing products with inventory data
    3. Create new products for items not in dim_product
    """
    if items_df.empty:
        return 0

    # Get existing products by product_code
    with conn.cursor() as cur:
        cur.execute("SELECT product_id, product_code FROM dw.dim_product WHERE product_code IS NOT NULL")
        existing = {row[1]: row[0] for row in cur.fetchall()}

    # Get max product_id for new products
    with conn.cursor() as cur:
        cur.execute("SELECT COALESCE(MAX(product_id), 0) FROM dw.dim_product")
        max_id = cur.fetchone()[0] or 0

    # Split into updates and inserts
    items_df = items_df.copy()
    items_df["_existing_id"] = items_df["product_code"].map(existing)

    updates_df = items_df[items_df["_existing_id"].notna()].copy()
    inserts_df = items_df[items_df["_existing_id"].isna()].copy()

    total_processed = 0

    # Update existing products
    if not updates_df.empty:
        updates_df["product_id"] = updates_df["_existing_id"].astype(int)
        update_cols = [
            "product_id", "xero_item_id", "item_name", "item_description",
            "is_tracked_as_inventory", "inventory_asset_account_code",
            "total_cost_pool", "quantity_on_hand", "purchase_unit_price",
            "cogs_account_code", "price", "sales_account_code"
        ]
        updates_df = updates_df[update_cols]

        count = upsert_dataframe(conn, "dw.dim_product", updates_df, ("product_id",))
        logger.info(f"Updated {count} existing products with inventory data")
        total_processed += count

    # Insert new products
    if not inserts_df.empty:
        # Generate new product IDs
        inserts_df = inserts_df.copy()
        inserts_df["product_id"] = range(max_id + 1, max_id + 1 + len(inserts_df))
        inserts_df["product_group"] = "Xero Items"

        insert_cols = [
            "product_id", "product_code", "xero_item_id", "item_name", "item_description",
            "product_group", "is_tracked_as_inventory", "inventory_asset_account_code",
            "total_cost_pool", "quantity_on_hand", "purchase_unit_price",
            "cogs_account_code", "price", "sales_account_code"
        ]
        inserts_df = inserts_df[insert_cols]

        count = upsert_dataframe(conn, "dw.dim_product", inserts_df, ("product_id",))
        logger.info(f"Created {count} new products from Xero Items")
        total_processed += count

    return total_processed


def main():
    """Main entry point for Items sync process."""
    load_dotenv(override=True)

    logger.info("Starting Xero Items sync process")
    logger.info(f"Python version: {sys.version.split()[0]}")

    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")

    # Items API requires accounting.settings.read scope
    creds = XeroCredentials(
        client_id=os.getenv("XERO_CLIENT_ID", ""),
        client_secret=os.getenv("XERO_CLIENT_SECRET", ""),
        tenant_id=os.getenv("XERO_TENANT_ID", ""),
        scopes=os.getenv("XERO_SCOPES", "accounting.transactions.read accounting.contacts.read accounting.settings.read"),
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

        # Initialize Xero client
        client = XeroClient(creds, conn)

        # Fetch items from Xero
        items = fetch_items(client)

        if not items:
            logger.info("No items to process")
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO dw.etl_run_log(pipeline_name, status, processed_rows) VALUES (%s, %s, %s)",
                    ("items_sync", "success", 0),
                )
            conn.commit()
            return

        # Transform to DataFrame
        items_df = transform_items(items)
        logger.info(f"Transformed {len(items_df)} items")

        # Sync to dim_product
        try:
            processed = sync_items_to_products(conn, items_df)

            # Log successful run
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO dw.etl_run_log(pipeline_name, status, processed_rows, finished_at) "
                    "VALUES (%s, %s, %s, timezone('utc', now()))",
                    ("items_sync", "success", processed),
                )
            conn.commit()
            logger.info(f"Items sync completed successfully. Processed {processed} products.")

        except Exception as e:
            logger.error(f"Error during data processing: {e}")
            conn.rollback()

            # Log failed run
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "INSERT INTO dw.etl_run_log(pipeline_name, status, processed_rows, error_message, finished_at) "
                        "VALUES (%s, %s, %s, %s, timezone('utc', now()))",
                        ("items_sync", "failed", 0, str(e)),
                    )
                conn.commit()
            except Exception as log_error:
                logger.error(f"Failed to log error: {log_error}")

            raise

    except Exception as e:
        logger.error(f"Fatal error in Items sync: {e}", exc_info=True)
        raise

    finally:
        if conn:
            conn.close()
            logger.info("Database connection closed")


if __name__ == "__main__":
    main()
