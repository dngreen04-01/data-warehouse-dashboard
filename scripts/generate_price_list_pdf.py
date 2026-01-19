"""
PDF Price List Generator for Product Catalog

Generates a branded price list matching the Akina Trading Ltd format:
- Yellow diagonal stripe with Klipon logo
- Company contact details with icons
- Red separator line
- Professional product table with unit and bulk prices
"""

import io
import os
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fpdf import FPDF


COMPANY_NAME = "AKINA TRADING LTD"
COMPANY_EMAIL = "admin@klipon.co.nz"
COMPANY_ADDRESS = "44 Tukorako Dr, Mt Maunganui, NZ"
LOGO_PATH = Path(__file__).parent / "assets" / "klipon-yellow-background.png"

# Brand colors (RGB)
BRAND_RED = (192, 14, 45)  # Matching the example
BRAND_YELLOW = (255, 221, 0)  # Yellow for the stripe


class PriceListPDF(FPDF):
    """Custom PDF class for price list generation."""

    def __init__(self):
        super().__init__()
        self.effective_date = datetime.now().strftime("%d %B %Y")

    def header(self):
        """Add header with yellow stripe, logo, and company details."""
        # Draw yellow diagonal stripe on the left
        self.set_fill_color(*BRAND_YELLOW)
        # Create a polygon for the diagonal stripe
        # Points: top-left, top at x=90, bottom at x=70, bottom-left
        self.polygon(
            [(0, 0), (90, 0), (70, 55), (0, 55)],
            style='F'
        )

        # Add logo on the yellow stripe
        if LOGO_PATH.exists():
            self.image(str(LOGO_PATH), x=8, y=8, w=55)

        # Company name (right side, bold red)
        self.set_xy(100, 12)
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*BRAND_RED)
        self.cell(0, 8, COMPANY_NAME, align="R")

        # Email with envelope symbol
        self.set_xy(100, 24)
        self.set_font("Helvetica", "", 11)
        self.set_text_color(80, 80, 80)
        self.cell(0, 6, COMPANY_EMAIL, align="R")

        # Address with location indicator
        self.set_xy(100, 32)
        self.cell(0, 6, COMPANY_ADDRESS, align="R")

        # Red separator line below header
        self.set_draw_color(*BRAND_RED)
        self.set_line_width(1.5)
        self.line(10, 58, 200, 58)

        # Reset for content
        self.set_line_width(0.2)
        self.set_draw_color(0, 0, 0)
        self.ln(50)

    def add_title(self):
        """Add the pricing effective date title."""
        self.set_y(68)
        self.set_font("Helvetica", "B", 18)
        self.set_text_color(*BRAND_RED)
        self.cell(0, 12, f"Pricing Effective {self.effective_date}", ln=True)
        self.set_text_color(0, 0, 0)
        self.ln(8)

    def add_table_header(self):
        """Add the table header row."""
        self.set_font("Helvetica", "B", 11)
        self.set_fill_color(*BRAND_RED)
        self.set_text_color(255, 255, 255)
        self.set_draw_color(*BRAND_RED)

        col_widths = [95, 45, 50]  # Product, Unit Price, Bulk Price
        headers = ["Product", "Unit Price", "Bulk Price (+10 carton)"]

        for i, header in enumerate(headers):
            align = "L" if i == 0 else "C"
            self.cell(col_widths[i], 12, header, border=1, align=align, fill=True)
        self.ln()

        self.set_text_color(0, 0, 0)
        self.set_draw_color(200, 200, 200)

    def add_product_row(self, product_name: str, unit_price: float | None, bulk_price: float | None):
        """Add a single product row."""
        self.set_font("Helvetica", "", 10)
        col_widths = [95, 45, 50]

        # Light gray border for rows
        self.set_draw_color(200, 200, 200)

        self.cell(col_widths[0], 10, product_name[:50], border=1)  # Truncate long names
        self.cell(col_widths[1], 10, format_currency(unit_price) if unit_price else "", border=1, align="C")
        self.cell(col_widths[2], 10, format_currency(bulk_price) if bulk_price else "", border=1, align="C")
        self.ln()


def format_currency(amount: float | Decimal | None) -> str:
    """Format amount as currency."""
    if amount is None:
        return ""
    # Handle NaN values
    try:
        val = float(amount)
        if val != val:  # NaN check
            return ""
        return f"${val:,.2f}"
    except (ValueError, TypeError):
        return ""


def fetch_products(conn, price_source: str = "xero", product_group: str | None = None) -> list[dict]:
    """
    Fetch products for the price list.

    Args:
        conn: Database connection
        price_source: "xero" to use price field, "custom" to use price_list_price
        product_group: Optional filter by product group

    Returns:
        List of product dictionaries with name, unit_price, bulk_price
    """
    query = """
        SELECT
            item_name,
            price,
            price_list_price,
            bulk_price
        FROM dw.dim_product
        WHERE archived = false
          AND is_tracked_as_inventory = true
    """
    params = []

    if product_group:
        query += " AND product_group = %s"
        params.append(product_group)

    query += " ORDER BY item_name"

    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    products = []
    for row in rows:
        item_name, price, price_list_price, bulk_price = row

        # Determine unit price based on source
        if price_source == "custom" and price_list_price is not None:
            unit_price = price_list_price
        else:
            unit_price = price

        products.append({
            "name": item_name,
            "unit_price": float(unit_price) if unit_price else None,
            "bulk_price": float(bulk_price) if bulk_price else None,
        })

    return products


def fetch_customer_products(conn, customer_id: str, include_all: bool = False) -> tuple[dict | None, list[dict]]:
    """
    Fetch products with effective prices for a customer.

    Args:
        conn: Database connection
        customer_id: The customer ID
        include_all: If True, include all products. If False, only products with custom prices.

    Returns:
        tuple of (customer_info dict, products list)
    """
    with conn.cursor() as cur:
        # Get customer info
        cur.execute("""
            SELECT customer_id, customer_name, merchant_group
            FROM dw.dim_customer
            WHERE customer_id = %s
        """, (customer_id,))
        row = cur.fetchone()
        if not row:
            return None, []

        customer_info = {
            "customer_id": row[0],
            "customer_name": row[1],
            "merchant_group": row[2]
        }

        # Get products with effective prices
        if include_all:
            cur.execute("""
                SELECT p.item_name,
                       COALESCE(cpo.custom_price, p.price_list_price, p.price) as effective_price,
                       COALESCE(cpo.custom_bulk_price, p.bulk_price) as effective_bulk_price,
                       CASE WHEN cpo.override_id IS NOT NULL THEN true ELSE false END as has_override
                FROM dw.dim_product p
                LEFT JOIN dw.customer_price_list cpl
                    ON cpl.customer_id = %s AND cpl.is_active = true AND cpl.effective_to IS NULL
                LEFT JOIN dw.customer_price_override cpo
                    ON cpo.price_list_id = cpl.price_list_id AND cpo.product_id = p.product_id
                WHERE p.archived = false AND p.is_tracked_as_inventory = true
                ORDER BY p.item_name
            """, (customer_id,))
        else:
            cur.execute("""
                SELECT p.item_name, cpo.custom_price, cpo.custom_bulk_price, true as has_override
                FROM dw.customer_price_list cpl
                JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
                JOIN dw.dim_product p ON p.product_id = cpo.product_id
                WHERE cpl.customer_id = %s AND cpl.is_active = true AND cpl.effective_to IS NULL
                ORDER BY p.item_name
            """, (customer_id,))

        products = [
            {
                "item_name": row[0],
                "price": row[1],
                "bulk_price": row[2],
                "has_override": row[3]
            }
            for row in cur.fetchall()
        ]

        return customer_info, products


def generate_customer_price_list_pdf(customer_info: dict, products: list[dict]) -> bytes:
    """Generate PDF price list for a specific customer."""
    pdf = PriceListPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Add customer name below header
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 8, f"Customer: {customer_info['customer_name']}", ln=True, align="L")
    if customer_info.get('merchant_group'):
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 5, f"Merchant Group: {customer_info['merchant_group']}", ln=True, align="L")
    pdf.ln(5)

    # Date
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(*BRAND_RED)
    today = datetime.now().strftime("%d %B %Y")
    pdf.cell(0, 8, f"Pricing Effective {today}", ln=True, align="L")
    pdf.ln(3)

    # Table header
    pdf.set_fill_color(240, 240, 240)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(100, 8, "Product", border=1, fill=True)
    pdf.cell(40, 8, "Unit Price", border=1, align="C", fill=True)
    pdf.cell(40, 8, "Bulk Price", border=1, align="C", fill=True)
    pdf.ln()

    # Table rows
    pdf.set_font("Helvetica", "", 10)
    for product in products:
        if pdf.get_y() > 260:
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 10)
            pdf.set_fill_color(240, 240, 240)
            pdf.cell(100, 8, "Product", border=1, fill=True)
            pdf.cell(40, 8, "Unit Price", border=1, align="C", fill=True)
            pdf.cell(40, 8, "Bulk Price", border=1, align="C", fill=True)
            pdf.ln()
            pdf.set_font("Helvetica", "", 10)

        name = product["item_name"][:50] if len(product["item_name"]) > 50 else product["item_name"]
        price = format_currency(product["price"]) if product["price"] else "-"
        bulk = format_currency(product["bulk_price"]) if product["bulk_price"] else "-"

        pdf.cell(100, 7, name, border=1)
        pdf.cell(40, 7, price, border=1, align="C")
        pdf.cell(40, 7, bulk, border=1, align="C")
        pdf.ln()

    return bytes(pdf.output())


def generate_price_list_pdf(products: list[dict]) -> bytes:
    """Generate the price list PDF and return as bytes."""
    pdf = PriceListPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.add_title()
    pdf.add_table_header()

    for product in products:
        # Check for page break
        if pdf.get_y() > 265:
            pdf.add_page()
            pdf.add_table_header()

        pdf.add_product_row(
            product["name"],
            product["unit_price"],
            product["bulk_price"]
        )

    return bytes(pdf.output())


def main():
    """Main function to generate price list PDF from command line."""
    import sys

    # Load environment variables
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path, override=True)

    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        print("Error: SUPABASE_CONNECTION_STRING not found in environment.")
        sys.exit(1)

    # Parse command line args
    price_source = "xero"
    product_group = None

    if len(sys.argv) > 1:
        price_source = sys.argv[1]
    if len(sys.argv) > 2:
        product_group = sys.argv[2]

    print(f"Generating price list with source={price_source}, group={product_group or 'all'}")

    # Create output directory
    output_dir = Path(__file__).parent.parent / "output" / "price_lists"
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        with psycopg.connect(conn_str) as conn:
            products = fetch_products(conn, price_source, product_group)

            if not products:
                print("No products found.")
                return

            pdf_bytes = generate_price_list_pdf(products)

            timestamp = datetime.now().strftime("%Y%m%d")
            output_file = output_dir / f"Price_List_{timestamp}.pdf"

            with open(output_file, "wb") as f:
                f.write(pdf_bytes)

            print(f"Generated: {output_file}")
            print(f"  → {len(products)} products included")

    except Exception as e:
        print(f"Error generating price list: {e}")
        raise


if __name__ == "__main__":
    main()
