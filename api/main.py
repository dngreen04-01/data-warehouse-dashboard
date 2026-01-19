"""
FastAPI backend for statement PDF generation and report processing.

Run with: uvicorn api.main:app --reload --port 8001
"""

import os
import io
from datetime import datetime
from pathlib import Path
from typing import Optional
from contextlib import asynccontextmanager

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks, Depends
from pydantic import BaseModel
from typing import List
from datetime import date
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx

from api.auth import get_current_user, require_auth, require_role, UserClaims

# Import PDF generator
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
sys.path.insert(0, str(Path(__file__).parent.parent))
from generate_statement_pdf import fetch_statement_data, StatementPDF, format_currency
from generate_price_list_pdf import fetch_products as fetch_price_list_products, generate_price_list_pdf
from src.reporting.sales_report import process_queue
from src.ingestion.xero_inventory import XeroInventoryAdjuster, InventoryItem
from src.ingestion.sync_xero import XeroClient, XeroCredentials

# Load environment
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path, override=True)

app = FastAPI(
    title="Statement PDF API",
    description="Generate PDF statements for merchants",
    version="1.0.0"
)

# CORS for frontend - parameterized for Cloud Run deployment
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:5174,http://localhost:3000").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db_connection():
    """Get database connection."""
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise HTTPException(status_code=500, detail="Database connection not configured")
    return psycopg.connect(conn_str)


def generate_pdf_bytes(
    merchant_name: str,
    head_office_address: str | None,
    branches: dict,
    aging_summary: dict
) -> bytes:
    """Generate PDF and return as bytes."""
    pdf = StatementPDF(merchant_name, head_office_address)
    pdf.set_auto_page_break(auto=True, margin=25)
    pdf.add_page()

    # Column widths
    page_width = pdf.w - pdf.l_margin - pdf.r_margin
    col_date = 30
    col_amount = 35
    col_balance = 35
    col_transaction = page_width - col_date - col_amount - col_balance

    def add_table_header():
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(col_date, 7, "Date", border=1, fill=True)
        pdf.cell(col_transaction, 7, "Transaction", border=1, fill=True)
        pdf.cell(col_amount, 7, "Amount", border=1, align="R", fill=True)
        pdf.cell(col_balance, 7, "Balance", border=1, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")

    # Process each branch
    for branch_name, invoices in sorted(branches.items()):
        if pdf.get_y() > 230:
            pdf.add_page()

        pdf.set_font("Helvetica", "B", 10)
        pdf.set_fill_color(220, 220, 220)
        pdf.cell(0, 8, branch_name, border=1, fill=True, new_x="LMARGIN", new_y="NEXT")

        add_table_header()

        invoices_sorted = sorted(invoices, key=lambda x: x['invoice_date'])
        balance = 0

        pdf.set_font("Helvetica", "", 9)
        for inv in invoices_sorted:
            if pdf.get_y() > 265:
                pdf.add_page()
                add_table_header()

            amount = inv['outstanding_amount']
            balance += amount
            date_str = inv['invoice_date'].strftime("%d %b %Y") if inv['invoice_date'] else ""

            pdf.cell(col_date, 6, date_str, border=1)
            pdf.cell(col_transaction, 6, inv['invoice_number'] or "", border=1)
            pdf.cell(col_amount, 6, format_currency(amount), border=1, align="R")
            pdf.cell(col_balance, 6, format_currency(balance), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(col_date + col_transaction, 7, f"Balance Due - {branch_name}", border=1)
        pdf.cell(col_amount, 7, "", border=1)
        pdf.cell(col_balance, 7, format_currency(balance), border=1, align="R", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(5)

    # Aging Summary
    if pdf.get_y() > 200:
        pdf.add_page()

    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 10, "Aging Summary", new_x="LMARGIN", new_y="NEXT")

    aging_labels = [
        ('current', 'Current'),
        ('1-30', '1-30 Days'),
        ('31-60', '31-60 Days'),
        ('61-90', '61-90 Days'),
        ('90+', 'Over 90 Days')
    ]
    aging_col_width = page_width / 6

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_fill_color(240, 240, 240)

    for key, label in aging_labels:
        pdf.cell(aging_col_width, 8, label, border=1, align="C", fill=True)
    pdf.cell(aging_col_width, 8, "Total", border=1, align="C", fill=True, new_x="LMARGIN", new_y="NEXT")

    pdf.set_font("Helvetica", "", 10)
    total = 0
    for key, label in aging_labels:
        amount = aging_summary.get(key, 0)
        total += amount
        pdf.cell(aging_col_width, 8, format_currency(amount), border=1, align="R")
    pdf.cell(aging_col_width, 8, format_currency(total), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, f"Total Outstanding: {format_currency(total)}", align="R", new_x="LMARGIN", new_y="NEXT")

    # Return as bytes
    return bytes(pdf.output())


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "Statement PDF API"}


@app.get("/api/merchants")
async def list_merchants():
    """List all merchants with statement data."""
    try:
        with get_db_connection() as conn:
            merchants = fetch_statement_data(conn)

            result = []
            for name, data in merchants.items():
                total = sum(data['aging_summary'].values())
                invoice_count = sum(len(invs) for invs in data['branches'].values())
                branch_count = len(data['branches'])

                result.append({
                    "merchant_group": name,
                    "head_office_address": data['head_office_address'],
                    "total_outstanding": total,
                    "invoice_count": invoice_count,
                    "branch_count": branch_count,
                    "aging_summary": data['aging_summary']
                })

            return {"merchants": result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/statement/{merchant_group}/pdf")
async def generate_statement_pdf(
    merchant_group: str,
):
    """Generate and download PDF statement for a merchant."""
    try:
        with get_db_connection() as conn:
            merchants = fetch_statement_data(conn, merchant_group)

            if not merchants or merchant_group not in merchants:
                raise HTTPException(status_code=404, detail=f"No statement data found for {merchant_group}")

            data = merchants[merchant_group]

            # Generate PDF
            pdf_bytes = generate_pdf_bytes(
                merchant_name=merchant_group,
                head_office_address=data['head_office_address'],
                branches=data['branches'],
                aging_summary=data['aging_summary']
            )

            # Create filename
            safe_name = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in merchant_group)
            timestamp = datetime.now().strftime("%Y%m%d")
            filename = f"Statement_{safe_name}_{timestamp}.pdf"

            return StreamingResponse(
                io.BytesIO(pdf_bytes),
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                }
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/price-list/pdf")
async def get_price_list_pdf(
    price_source: str = "xero",
    product_group: str | None = None
):
    """Generate and download PDF price list.

    Args:
        price_source: "xero" to use Xero prices, "custom" to use price_list_price
        product_group: Optional filter by product group
    """
    try:
        with get_db_connection() as conn:
            products = fetch_price_list_products(conn, price_source, product_group)

            if not products:
                raise HTTPException(status_code=404, detail="No products found")

            pdf_bytes = generate_price_list_pdf(products)

            timestamp = datetime.now().strftime("%Y%m%d")
            filename = f"Price_List_{timestamp}.pdf"

            return StreamingResponse(
                io.BytesIO(pdf_bytes),
                media_type="application/pdf",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Customer Price List Endpoints
# =============================================================================

class PriceOverrideInput(BaseModel):
    product_id: int
    custom_price: float
    custom_bulk_price: float | None = None


class CreatePriceListRequest(BaseModel):
    name: str = "Custom Prices"
    description: str | None = None
    overrides: list[PriceOverrideInput] = []


class UpdatePriceListRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    overrides: list[PriceOverrideInput] | None = None


@app.get("/api/customers/{customer_id}/price-list")
async def get_customer_price_list(customer_id: str):
    """Get the active price list for a customer with all overrides."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Get customer info and price list header
            cur.execute("""
                SELECT c.customer_id, c.customer_name,
                       cpl.price_list_id, cpl.name, cpl.description,
                       cpl.effective_from, cpl.is_active
                FROM dw.dim_customer c
                LEFT JOIN dw.customer_price_list cpl
                    ON cpl.customer_id = c.customer_id
                    AND cpl.is_active = true
                    AND cpl.effective_to IS NULL
                WHERE c.customer_id = %s
            """, (customer_id,))
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Customer not found")

            cust_id, customer_name, price_list_id, name, description, effective_from, is_active = row

            if price_list_id is None:
                return {"customer_id": cust_id, "customer_name": customer_name, "price_list": None}

            # Get overrides
            cur.execute("""
                SELECT cpo.override_id, cpo.product_id, p.product_code, p.item_name,
                       p.price as default_price, cpo.custom_price, cpo.custom_bulk_price
                FROM dw.customer_price_override cpo
                JOIN dw.dim_product p ON p.product_id = cpo.product_id
                WHERE cpo.price_list_id = %s
                ORDER BY p.item_name
            """, (price_list_id,))

            overrides = [
                {
                    "override_id": r[0], "product_id": r[1], "product_code": r[2],
                    "item_name": r[3], "default_price": float(r[4]) if r[4] else None,
                    "custom_price": float(r[5]), "custom_bulk_price": float(r[6]) if r[6] else None
                }
                for r in cur.fetchall()
            ]

            return {
                "customer_id": cust_id,
                "customer_name": customer_name,
                "price_list": {
                    "price_list_id": price_list_id,
                    "name": name,
                    "description": description,
                    "effective_from": effective_from.isoformat() if effective_from else None,
                    "is_active": is_active,
                    "override_count": len(overrides),
                    "overrides": overrides
                }
            }


@app.post("/api/customers/{customer_id}/price-list")
async def create_customer_price_list(customer_id: str, request: CreatePriceListRequest):
    """Create a new price list for a customer. Deactivates any existing active list."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify customer exists
            cur.execute("SELECT customer_id FROM dw.dim_customer WHERE customer_id = %s", (customer_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Customer not found")

            # Deactivate existing active price lists
            cur.execute("""
                UPDATE dw.customer_price_list
                SET is_active = false, effective_to = CURRENT_DATE
                WHERE customer_id = %s AND is_active = true
            """, (customer_id,))

            # Create new price list
            cur.execute("""
                INSERT INTO dw.customer_price_list (customer_id, name, description)
                VALUES (%s, %s, %s)
                RETURNING price_list_id
            """, (customer_id, request.name, request.description))
            price_list_id = cur.fetchone()[0]

            # Insert overrides
            if request.overrides:
                for override in request.overrides:
                    cur.execute("""
                        INSERT INTO dw.customer_price_override
                            (price_list_id, product_id, custom_price, custom_bulk_price)
                        VALUES (%s, %s, %s, %s)
                    """, (price_list_id, override.product_id, override.custom_price, override.custom_bulk_price))

            conn.commit()
            return {"price_list_id": price_list_id, "message": "Price list created"}


@app.put("/api/customers/{customer_id}/price-list/{price_list_id}")
async def update_customer_price_list(customer_id: str, price_list_id: int, request: UpdatePriceListRequest):
    """Update an existing price list."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify price list exists and belongs to customer
            cur.execute("""
                SELECT price_list_id FROM dw.customer_price_list
                WHERE price_list_id = %s AND customer_id = %s AND is_active = true
            """, (price_list_id, customer_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Price list not found")

            # Update header fields if provided
            if request.name is not None or request.description is not None:
                updates = []
                params = []
                if request.name is not None:
                    updates.append("name = %s")
                    params.append(request.name)
                if request.description is not None:
                    updates.append("description = %s")
                    params.append(request.description)
                updates.append("updated_at = timezone('utc', now())")
                params.append(price_list_id)

                cur.execute(f"""
                    UPDATE dw.customer_price_list
                    SET {', '.join(updates)}
                    WHERE price_list_id = %s
                """, params)

            # Replace overrides if provided
            if request.overrides is not None:
                cur.execute("DELETE FROM dw.customer_price_override WHERE price_list_id = %s", (price_list_id,))
                for override in request.overrides:
                    cur.execute("""
                        INSERT INTO dw.customer_price_override
                            (price_list_id, product_id, custom_price, custom_bulk_price)
                        VALUES (%s, %s, %s, %s)
                    """, (price_list_id, override.product_id, override.custom_price, override.custom_bulk_price))

            conn.commit()
            return {"message": "Price list updated"}


@app.delete("/api/customers/{customer_id}/price-list/{price_list_id}")
async def delete_customer_price_list(customer_id: str, price_list_id: int):
    """Soft delete (deactivate) a price list."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE dw.customer_price_list
                SET is_active = false, effective_to = CURRENT_DATE, updated_at = timezone('utc', now())
                WHERE price_list_id = %s AND customer_id = %s AND is_active = true
                RETURNING price_list_id
            """, (price_list_id, customer_id))

            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Price list not found")

            conn.commit()
            return {"message": "Price list deleted"}


@app.get("/api/customers/{customer_id}/price-list/pdf")
async def get_customer_price_list_pdf(customer_id: str, include_all: bool = False):
    """Generate PDF price list for a specific customer.

    Args:
        customer_id: The customer ID
        include_all: If True, include all products with effective prices.
                     If False, only include products with custom prices.
    """
    from scripts.generate_price_list_pdf import fetch_customer_products, generate_customer_price_list_pdf

    with get_db_connection() as conn:
        customer_info, products = fetch_customer_products(conn, customer_id, include_all)

        if not customer_info:
            raise HTTPException(status_code=404, detail="Customer not found")

        pdf_bytes = generate_customer_price_list_pdf(customer_info, products)

        safe_name = customer_info['customer_name'].replace(' ', '_').replace('/', '-')
        filename = f"Price_List_{safe_name}_{datetime.now().strftime('%Y%m%d')}.pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )


def run_queue_processor():
    """Process the report queue synchronously."""
    sg_key = os.getenv("SENDGRID_API_KEY")
    if not sg_key:
        raise HTTPException(status_code=500, detail="SENDGRID_API_KEY not configured")

    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise HTTPException(status_code=500, detail="Database connection not configured")

    conn = psycopg.connect(conn_str, row_factory=dict_row)
    try:
        process_queue(conn, sg_key)
    finally:
        conn.close()


@app.post("/api/process-report-queue")
async def trigger_report_queue(background_tasks: BackgroundTasks):
    """Process pending report queue items immediately."""
    background_tasks.add_task(run_queue_processor)
    return {"status": "processing", "message": "Report queue processing started"}


# =============================================================================
# Manufacturing / Production Conversion Endpoints
# =============================================================================

# Pydantic models for manufacturing
class FinishedGoodInput(BaseModel):
    product_code: str
    product_name: str
    quantity: float
    unit_weight_kg: float  # Weight per unit (1kg or 10kg)


class ConversionRequest(BaseModel):
    bulk_product_code: str
    bags_consumed: float
    finished_goods: List[FinishedGoodInput]
    conversion_date: date
    notes: str | None = None


class ConversionResponse(BaseModel):
    success: bool
    conversion_id: int | None = None
    xero_credit_note_id: str | None = None
    xero_invoice_id: str | None = None
    message: str
    bulk_total_value: float | None = None
    finished_unit_costs: dict | None = None


# Manufacturing product configuration
BULK_PRODUCTS = {
    "TUIT_CL_UP": {
        "name": "Cotton Tuit Bulk",
        "bag_weight_kg": 11.0,
        "material_type": "cotton",
        "converts_to": ["KLIPTUIT02", "KLIPTUIT03"]
    },
    "TUIT_NY_UP": {
        "name": "Nylon Tuit Bulk",
        "bag_weight_kg": 10.0,
        "material_type": "nylon",
        "converts_to": ["KLIPTUIT04", "KLIPTUIT05"]
    }
}

FINISHED_PRODUCTS = {
    "KLIPTUIT02": {"name": "Klip Tuit Cotton 10kg", "weight_kg": 10.0, "material_type": "cotton"},
    "KLIPTUIT03": {"name": "Klip Tuit Cotton 1kg", "weight_kg": 1.0, "material_type": "cotton"},
    "KLIPTUIT04": {"name": "Klip Tuit Nylon 10kg", "weight_kg": 10.0, "material_type": "nylon"},
    "KLIPTUIT05": {"name": "Klip Tuit Nylon 1kg", "weight_kg": 1.0, "material_type": "nylon"},
}


def get_xero_client():
    """Create and return an authenticated Xero client."""
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise HTTPException(status_code=500, detail="Database connection not configured")

    creds = XeroCredentials(
        client_id=os.getenv("XERO_CLIENT_ID", ""),
        client_secret=os.getenv("XERO_CLIENT_SECRET", ""),
        tenant_id=os.getenv("XERO_TENANT_ID", ""),
        scopes=os.getenv("XERO_SCOPES", "accounting.transactions accounting.transactions.read accounting.contacts.read accounting.settings.read"),
    )

    if not all([creds.client_id, creds.client_secret, creds.tenant_id]):
        raise HTTPException(status_code=500, detail="Xero credentials not configured")

    conn = psycopg.connect(conn_str)
    return XeroClient(creds, conn), conn


@app.get("/api/manufacturing/products")
async def get_manufacturing_products():
    """Get all products involved in manufacturing (bulk and finished)."""
    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                # Get bulk products - include total_cost_pool for NZD landed cost calculation
                cur.execute("""
                    SELECT
                        product_code,
                        item_name,
                        quantity_on_hand,
                        total_cost_pool,
                        inventory_asset_account_code
                    FROM dw.dim_product
                    WHERE product_code IN ('TUIT_CL_UP', 'TUIT_NY_UP')
                    AND archived = false
                """)
                bulk_rows = cur.fetchall()

                # Get finished products
                cur.execute("""
                    SELECT
                        product_code,
                        item_name,
                        quantity_on_hand,
                        total_cost_pool,
                        inventory_asset_account_code
                    FROM dw.dim_product
                    WHERE product_code IN ('KLIPTUIT02', 'KLIPTUIT03', 'KLIPTUIT04', 'KLIPTUIT05')
                    AND archived = false
                """)
                finished_rows = cur.fetchall()

        # Enrich with configuration and calculate landed cost
        bulk_products = []
        for row in bulk_rows:
            config = BULK_PRODUCTS.get(row["product_code"], {})
            qty = float(row["quantity_on_hand"] or 0)
            cost_pool = float(row["total_cost_pool"] or 0)
            landed_cost_per_kg = cost_pool / qty if qty > 0 else 0
            bulk_products.append({
                **row,
                "bag_weight_kg": config.get("bag_weight_kg"),
                "material_type": config.get("material_type"),
                "converts_to": config.get("converts_to", []),
                "landed_cost_per_kg": landed_cost_per_kg  # NZD per kg
            })

        finished_products = []
        for row in finished_rows:
            config = FINISHED_PRODUCTS.get(row["product_code"], {})
            qty = float(row["quantity_on_hand"] or 0)
            cost_pool = float(row["total_cost_pool"] or 0)
            landed_cost_per_unit = cost_pool / qty if qty > 0 else 0
            finished_products.append({
                **row,
                "weight_kg": config.get("weight_kg"),
                "material_type": config.get("material_type"),
                "landed_cost_per_unit": landed_cost_per_unit  # NZD per unit
            })

        return {
            "bulk_products": bulk_products,
            "finished_products": finished_products
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/manufacturing/convert", response_model=ConversionResponse)
async def process_conversion(request: ConversionRequest):
    """Process a manufacturing conversion from bulk to finished goods."""
    try:
        # Validate bulk product
        if request.bulk_product_code not in BULK_PRODUCTS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid bulk product code: {request.bulk_product_code}"
            )

        bulk_config = BULK_PRODUCTS[request.bulk_product_code]
        material_type = bulk_config["material_type"]

        # Validate finished goods are compatible with bulk material
        for fg in request.finished_goods:
            fg_config = FINISHED_PRODUCTS.get(fg.product_code)
            if not fg_config:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid finished product code: {fg.product_code}"
                )
            if fg_config["material_type"] != material_type:
                raise HTTPException(
                    status_code=400,
                    detail=f"Product {fg.product_code} ({fg_config['material_type']}) is not compatible with {request.bulk_product_code} ({material_type})"
                )

        # Calculate quantities and values
        kg_consumed = request.bags_consumed * bulk_config["bag_weight_kg"]

        # Get current prices from database
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                # Get bulk product - use total_cost_pool / quantity_on_hand for landed cost (NZD)
                cur.execute("""
                    SELECT total_cost_pool, quantity_on_hand, inventory_asset_account_code, item_name
                    FROM dw.dim_product
                    WHERE product_code = %s
                """, (request.bulk_product_code,))
                bulk_row = cur.fetchone()

                if not bulk_row:
                    raise HTTPException(
                        status_code=404,
                        detail=f"Bulk product not found: {request.bulk_product_code}"
                    )

                # Calculate landed cost in NZD from cost pool (not USD purchase price)
                quantity_on_hand = float(bulk_row["quantity_on_hand"] or 0)
                total_cost_pool = float(bulk_row["total_cost_pool"] or 0)

                if quantity_on_hand <= 0:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Bulk product {request.bulk_product_code} has no stock on hand"
                    )

                bulk_unit_cost = total_cost_pool / quantity_on_hand  # NZD per kg
                bulk_account_code = bulk_row["inventory_asset_account_code"] or "575"
                bulk_name = bulk_row["item_name"]

                # Get finished product details
                finished_codes = [fg.product_code for fg in request.finished_goods]
                cur.execute("""
                    SELECT product_code, inventory_asset_account_code, item_name
                    FROM dw.dim_product
                    WHERE product_code = ANY(%s)
                """, (finished_codes,))
                finished_details = {row["product_code"]: row for row in cur.fetchall()}

        # Calculate bulk total value
        bulk_total_value = kg_consumed * bulk_unit_cost

        # Calculate total finished quantity (in kg equivalent)
        total_finished_kg = sum(fg.quantity * fg.unit_weight_kg for fg in request.finished_goods)

        # Calculate unit cost for finished goods (value per kg stays the same)
        finished_unit_costs = {}
        finished_items_for_xero = []

        for fg in request.finished_goods:
            fg_details = finished_details.get(fg.product_code, {})
            # Unit cost = (bulk_unit_cost per kg) * (weight of this unit)
            # This preserves total value: bulk_value = sum(finished_quantity * finished_unit_cost)
            unit_cost = bulk_unit_cost * fg.unit_weight_kg
            finished_unit_costs[fg.product_code] = unit_cost

            finished_items_for_xero.append(InventoryItem(
                item_code=fg.product_code,
                description=f"Production conversion from {request.bulk_product_code}",
                quantity=fg.quantity,
                unit_amount=unit_cost,
                account_code=fg_details.get("inventory_asset_account_code") or "575"
            ))

        # Create Xero adjustments
        xero_client, xero_conn = get_xero_client()
        try:
            adjuster = XeroInventoryAdjuster(xero_client)

            # Create bulk decrease item
            bulk_item = InventoryItem(
                item_code=request.bulk_product_code,
                description=f"Production conversion - {request.bags_consumed} bags consumed",
                quantity=kg_consumed,
                unit_amount=bulk_unit_cost,
                account_code=bulk_account_code
            )

            # Process the conversion in Xero
            credit_note_id, invoice_id = adjuster.process_conversion(
                bulk_item=bulk_item,
                finished_items=finished_items_for_xero,
                adjustment_date=request.conversion_date,
                reference_prefix="PROD"
            )

        finally:
            xero_conn.close()

        # Save conversion record to database
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                finished_goods_json = [
                    {
                        "product_code": fg.product_code,
                        "product_name": fg.product_name,
                        "quantity": fg.quantity,
                        "unit_cost": finished_unit_costs[fg.product_code],
                        "total_value": fg.quantity * finished_unit_costs[fg.product_code]
                    }
                    for fg in request.finished_goods
                ]

                cur.execute("""
                    INSERT INTO dw.production_conversion (
                        conversion_date,
                        bulk_product_code,
                        bulk_product_name,
                        bags_consumed,
                        kg_consumed,
                        bulk_unit_cost,
                        bulk_total_value,
                        finished_goods,
                        xero_credit_note_id,
                        xero_invoice_id,
                        notes
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                    RETURNING conversion_id
                """, (
                    request.conversion_date,
                    request.bulk_product_code,
                    bulk_name,
                    request.bags_consumed,
                    kg_consumed,
                    bulk_unit_cost,
                    bulk_total_value,
                    str(finished_goods_json).replace("'", '"'),
                    credit_note_id,
                    invoice_id,
                    request.notes
                ))
                conversion_id = cur.fetchone()[0]
            conn.commit()

        return ConversionResponse(
            success=True,
            conversion_id=conversion_id,
            xero_credit_note_id=credit_note_id,
            xero_invoice_id=invoice_id,
            message=f"Conversion completed successfully. Consumed {kg_consumed}kg of {request.bulk_product_code}.",
            bulk_total_value=bulk_total_value,
            finished_unit_costs=finished_unit_costs
        )

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/manufacturing/history")
async def get_conversion_history(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0)
):
    """Get conversion history records."""
    try:
        with get_db_connection() as conn:
            # Check if table exists first (use regular cursor for this)
            with conn.cursor() as check_cur:
                check_cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables
                        WHERE table_schema = 'dw'
                        AND table_name = 'production_conversion'
                    )
                """)
                table_exists = check_cur.fetchone()[0]

            if not table_exists:
                return {
                    "records": [],
                    "total": 0,
                    "limit": limit,
                    "offset": offset,
                    "message": "Table not yet created. Run the migration first."
                }

            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    SELECT
                        conversion_id,
                        conversion_date,
                        bulk_product_code,
                        bulk_product_name,
                        bags_consumed,
                        kg_consumed,
                        bulk_unit_cost,
                        bulk_total_value,
                        finished_goods,
                        xero_credit_note_id,
                        xero_invoice_id,
                        created_by,
                        created_at,
                        notes
                    FROM dw.production_conversion
                    ORDER BY conversion_date DESC
                    LIMIT %s OFFSET %s
                """, (limit, offset))
                records = cur.fetchall()

            # Get total count
            with conn.cursor() as count_cur:
                count_cur.execute("SELECT COUNT(*) FROM dw.production_conversion")
                total = count_cur.fetchone()[0]

        return {
            "records": records,
            "total": total,
            "limit": limit,
            "offset": offset
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/manufacturing/yield-estimate")
async def calculate_yield_estimate(
    bulk_product_code: str,
    bags_consumed: float
):
    """Calculate expected yield for a given bulk consumption."""
    if bulk_product_code not in BULK_PRODUCTS:
        raise HTTPException(status_code=400, detail=f"Invalid bulk product: {bulk_product_code}")

    config = BULK_PRODUCTS[bulk_product_code]
    kg_consumed = bags_consumed * config["bag_weight_kg"]

    return {
        "bulk_product_code": bulk_product_code,
        "bags_consumed": bags_consumed,
        "kg_consumed": kg_consumed,
        "expected_1kg_units": kg_consumed,  # Maximum if all packed as 1kg
        "expected_10kg_units": kg_consumed / 10,  # Maximum if all packed as 10kg
        "material_type": config["material_type"],
        "compatible_products": config["converts_to"]
    }


# =============================================================================
# User Management Endpoints
# =============================================================================

class InviteRequest(BaseModel):
    email: str
    role_id: str


class UpdateRoleRequest(BaseModel):
    role_id: str


@app.get("/api/users/me")
async def get_current_user_info(
    current_user: UserClaims = Depends(require_auth)
):
    """Get current user's role and permissions."""
    return {
        "user_id": current_user.sub,
        "email": current_user.email,
        "role": current_user.user_role,
        "permissions": current_user.permissions
    }


@app.get("/api/users")
async def list_users(
    current_user: UserClaims = Depends(require_auth)
):
    """List all users with their roles. Requires super_user or administration role."""
    print(f"[DEBUG] /api/users called by user: {current_user.email}, role: {current_user.user_role}")

    if current_user.user_role not in ['super_user', 'administration']:
        raise HTTPException(status_code=403, detail="Permission denied")

    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    SELECT
                        u.id as user_id,
                        u.email,
                        ur.role_id,
                        r.role_name,
                        u.last_sign_in_at,
                        u.created_at
                    FROM auth.users u
                    LEFT JOIN dw.user_roles ur ON u.id = ur.user_id
                    LEFT JOIN dw.app_roles r ON ur.role_id = r.role_id
                    ORDER BY u.created_at DESC
                """)
                users = cur.fetchall()

        return {"users": users}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/roles")
async def list_roles(
    current_user: UserClaims = Depends(require_auth)
):
    """List available roles."""
    print(f"[DEBUG] /api/roles called by user: {current_user.email}, role: {current_user.user_role}")

    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    SELECT role_id, role_name, description
                    FROM dw.app_roles
                    ORDER BY
                        CASE role_id
                            WHEN 'super_user' THEN 1
                            WHEN 'administration' THEN 2
                            WHEN 'sales' THEN 3
                            ELSE 4
                        END
                """)
                roles = cur.fetchall()

        return {"roles": roles}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    request: UpdateRoleRequest,
    current_user: UserClaims = Depends(require_auth)
):
    """Update a user's role. Only super_user can do this."""
    print(f"[DEBUG] /api/users/{user_id}/role called by user: {current_user.email}, role: {current_user.user_role}")

    # Authorization check
    if current_user.user_role != 'super_user':
        raise HTTPException(status_code=403, detail="Only super_user can update roles")

    # Prevent self-modification
    if current_user.sub == user_id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                # Validate role exists
                cur.execute("SELECT role_id FROM dw.app_roles WHERE role_id = %s", (request.role_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail=f"Invalid role: {request.role_id}")

                # Get target user info
                cur.execute("SELECT email FROM auth.users WHERE id = %s", (user_id,))
                user_row = cur.fetchone()
                if not user_row:
                    raise HTTPException(status_code=404, detail="User not found")

                # Get current role of target user
                cur.execute(
                    "SELECT role_id FROM dw.user_roles WHERE user_id = %s",
                    (user_id,)
                )
                current_role_row = cur.fetchone()
                target_current_role = current_role_row['role_id'] if current_role_row else None

                # If demoting from super_user, ensure we keep at least one
                if target_current_role == 'super_user' and request.role_id != 'super_user':
                    cur.execute("SELECT COUNT(*) as cnt FROM dw.user_roles WHERE role_id = 'super_user'")
                    super_count = cur.fetchone()['cnt']
                    if super_count <= 1:
                        raise HTTPException(
                            status_code=400,
                            detail="Cannot demote the last super_user"
                        )

                # Upsert the role
                cur.execute("""
                    INSERT INTO dw.user_roles (user_id, role_id, assigned_by, assigned_at)
                    VALUES (%s, %s, %s, timezone('utc', now()))
                    ON CONFLICT (user_id) DO UPDATE SET
                        role_id = EXCLUDED.role_id,
                        assigned_by = EXCLUDED.assigned_by,
                        assigned_at = EXCLUDED.assigned_at
                """, (user_id, request.role_id, current_user.sub))

            conn.commit()

        return {
            "success": True,
            "user_id": user_id,
            "email": user_row['email'],
            "new_role": request.role_id,
            "message": f"Role updated to {request.role_id}"
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/users/invite")
async def invite_user(
    request: InviteRequest,
    current_user: UserClaims = Depends(require_auth)
):
    """Invite a new user. Only super_user can do this."""
    if current_user.user_role != 'super_user':
        raise HTTPException(status_code=403, detail="Only super_user can invite users")

    # Cannot invite as super_user
    if request.role_id == 'super_user':
        raise HTTPException(status_code=400, detail="Cannot invite users as super_user")

    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                # Check if user already exists
                cur.execute("SELECT id FROM auth.users WHERE email = %s", (request.email,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="User with this email already exists")

                # Check if role exists
                cur.execute("SELECT role_id FROM dw.app_roles WHERE role_id = %s", (request.role_id,))
                if not cur.fetchone():
                    raise HTTPException(status_code=400, detail=f"Invalid role: {request.role_id}")

                # Check for existing pending invitation
                cur.execute("""
                    SELECT id FROM dw.user_invitations
                    WHERE email = %s AND status = 'pending'
                """, (request.email,))
                if cur.fetchone():
                    raise HTTPException(status_code=400, detail="Pending invitation already exists for this email")

                # Create invitation record
                cur.execute("""
                    INSERT INTO dw.user_invitations (email, role_id, invited_by)
                    VALUES (%s, %s, %s)
                    RETURNING id
                """, (request.email, request.role_id, current_user.sub))
                invitation_id = cur.fetchone()['id']

            conn.commit()

        # Use Supabase Admin API to send invite email
        service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        supabase_url = os.getenv("SUPABASE_URL")

        if not service_key or not supabase_url:
            raise HTTPException(
                status_code=500,
                detail="Supabase service role key not configured. Invitation created but email not sent."
            )

        # Get the frontend URL for redirect (default to localhost for dev)
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{supabase_url}/auth/v1/invite",
                headers={
                    "apikey": service_key,
                    "Authorization": f"Bearer {service_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "email": request.email,
                    "data": {"invited_role": request.role_id},
                    "redirect_to": frontend_url
                }
            )

            if response.status_code not in [200, 201]:
                # Log the error but don't fail - invitation record exists
                print(f"Warning: Supabase invite API returned {response.status_code}: {response.text}")

        return {
            "success": True,
            "invitation_id": str(invitation_id),
            "message": f"Invitation sent to {request.email}"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/users/invitations")
async def list_invitations(
    current_user: UserClaims = Depends(require_auth)
):
    """List pending invitations. Only super_user can view."""
    if current_user.user_role != 'super_user':
        raise HTTPException(status_code=403, detail="Only super_user can view invitations")

    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute("""
                    SELECT
                        i.id,
                        i.email,
                        i.role_id,
                        r.role_name,
                        i.invited_at,
                        i.expires_at,
                        u.email as invited_by_email
                    FROM dw.user_invitations i
                    JOIN dw.app_roles r ON i.role_id = r.role_id
                    JOIN auth.users u ON i.invited_by = u.id
                    WHERE i.status = 'pending'
                    AND i.expires_at > now()
                    ORDER BY i.invited_at DESC
                """)
                invitations = cur.fetchall()

        return {"invitations": invitations}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/users/invitations/{invitation_id}")
async def revoke_invitation(
    invitation_id: str,
    current_user: UserClaims = Depends(require_auth)
):
    """Revoke a pending invitation. Only super_user can revoke."""
    if current_user.user_role != 'super_user':
        raise HTTPException(status_code=403, detail="Only super_user can revoke invitations")

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE dw.user_invitations
                    SET status = 'revoked'
                    WHERE id = %s AND status = 'pending'
                """, (invitation_id,))
                success = cur.rowcount > 0
            conn.commit()

        return {"success": success}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# Supplier Stock Entry Endpoints
# =============================================================================

# Pydantic models for supplier stock
class ProductForStock(BaseModel):
    product_id: int
    product_code: str
    item_name: str
    cluster_id: Optional[int] = None
    cluster_label: Optional[str] = None
    current_week_qty: Optional[int] = None
    previous_week_qty: Optional[int] = None


class ClusterWithProducts(BaseModel):
    cluster_id: Optional[int] = None
    cluster_label: str
    products: List[ProductForStock]


class StockEntry(BaseModel):
    product_id: int
    quantity_on_hand: int


class SaveStockRequest(BaseModel):
    entries: List[StockEntry]


@app.get("/api/supplier/products", response_model=List[ClusterWithProducts])
async def get_supplier_products(
    current_user: UserClaims = Depends(require_role(["supplier", "super_user"]))
):
    """Get all products grouped by cluster for supplier stock entry."""
    try:
        with get_db_connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                # Get products with cluster info
                cur.execute("""
                    SELECT
                        p.product_id,
                        p.product_code,
                        p.item_name,
                        c.cluster_id,
                        c.cluster_label
                    FROM dw.dim_product p
                    LEFT JOIN dw.dim_product_cluster pc ON p.product_id = pc.product_id
                    LEFT JOIN dw.dim_cluster c ON pc.cluster_id = c.cluster_id AND c.cluster_type = 'product'
                    WHERE p.archived = false
                      AND p.is_tracked_as_inventory = true
                    ORDER BY c.cluster_label NULLS LAST, p.item_name
                """)
                products = cur.fetchall()

                # Get stock entries for this user
                cur.execute("""
                    SELECT product_id, current_week_qty, previous_week_qty
                    FROM public.get_supplier_stock_entries(%s)
                """, (current_user.sub,))
                stock_rows = cur.fetchall()
                stock_entries = {
                    row["product_id"]: {
                        "current": row["current_week_qty"],
                        "previous": row["previous_week_qty"]
                    }
                    for row in stock_rows
                }

        # Group products by cluster
        clusters: dict = {}
        for row in products:
            product_id = row["product_id"]
            cluster_id = row["cluster_id"]
            cluster_label = row["cluster_label"] if row["cluster_label"] else "Unclustered"

            # Use cluster_id as key, or 0 for unclustered
            key = cluster_id if cluster_id else 0

            if key not in clusters:
                clusters[key] = {
                    "cluster_id": cluster_id,
                    "cluster_label": cluster_label,
                    "products": []
                }

            stock = stock_entries.get(product_id, {"current": None, "previous": None})
            clusters[key]["products"].append({
                "product_id": product_id,
                "product_code": row["product_code"],
                "item_name": row["item_name"],
                "cluster_id": cluster_id,
                "cluster_label": row["cluster_label"],
                "current_week_qty": stock["current"],
                "previous_week_qty": stock["previous"]
            })

        # Sort clusters: named clusters first (alphabetically), then Unclustered
        result = sorted(
            clusters.values(),
            key=lambda c: (c["cluster_id"] is None, c["cluster_label"])
        )
        return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/supplier/stock")
async def save_supplier_stock(
    request: SaveStockRequest,
    current_user: UserClaims = Depends(require_role(["supplier", "super_user"]))
):
    """Save supplier stock entries for the current week."""
    if not request.entries:
        return {"status": "ok", "message": "No entries to save", "entries_saved": 0}

    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                # Get current week ending
                cur.execute("SELECT dw.get_week_ending(CURRENT_DATE)")
                week_ending = cur.fetchone()[0]

                # Upsert each entry
                for entry in request.entries:
                    cur.execute("""
                        INSERT INTO dw.supplier_stock_entry
                            (user_id, product_id, quantity_on_hand, week_ending)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (user_id, product_id, week_ending)
                        DO UPDATE SET
                            quantity_on_hand = EXCLUDED.quantity_on_hand,
                            updated_at = timezone('utc', now())
                    """, (current_user.sub, entry.product_id, entry.quantity_on_hand, week_ending))

            conn.commit()

        return {
            "status": "ok",
            "message": f"Saved {len(request.entries)} entries for week ending {week_ending}",
            "week_ending": str(week_ending),
            "entries_saved": len(request.entries)
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/supplier/current-week")
async def get_current_week(
    current_user: UserClaims = Depends(require_role(["supplier", "super_user"]))
):
    """Get the current week ending date for display purposes."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT dw.get_week_ending(CURRENT_DATE)")
                week_ending = cur.fetchone()[0]
                return {
                    "week_ending": str(week_ending),
                    "week_ending_formatted": week_ending.strftime("%B %d, %Y")
                }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
