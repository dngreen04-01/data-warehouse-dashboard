"""
PDF Price List Generator for Product Catalog

Generates a branded price list matching the Akina Trading Ltd format:
- Klipon logo header with company contact details
- Effective date
- Product table with unit and bulk prices
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
LOGO_PATH = Path(__file__).parent / "assets" / "klipon-logo.png"

# Brand colors (RGB)
BRAND_RED = (192, 0, 0)


class PriceListPDF(FPDF):
    """Custom PDF class for price list generation."""

    def __init__(self):
        super().__init__()
        self.effective_date = datetime.now().strftime("%d %B %Y")

    def header(self):
        """Add header with logo and company details."""
        # Logo (left side)
        if LOGO_PATH.exists():
            self.image(str(LOGO_PATH), x=10, y=8, w=50)

        # Company details (right side)
        self.set_xy(120, 10)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(*BRAND_RED)
        self.cell(0, 6, COMPANY_NAME, align="R")

        self.set_xy(120, 18)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(0, 0, 0)
        self.cell(0, 5, COMPANY_EMAIL, align="R")

        self.set_xy(120, 24)
        self.cell(0, 5, COMPANY_ADDRESS, align="R")

        self.ln(30)

    def add_title(self):
        """Add the pricing effective date title."""
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(*BRAND_RED)
        self.cell(0, 10, f"Pricing Effective {self.effective_date}", ln=True)
        self.set_text_color(0, 0, 0)
        self.ln(5)

    def add_table_header(self):
        """Add the table header row."""
        self.set_font("Helvetica", "B", 10)
        self.set_fill_color(*BRAND_RED)
        self.set_text_color(255, 255, 255)

        col_widths = [100, 40, 50]  # Product, Unit Price, Bulk Price
        headers = ["Product", "Unit Price", "Bulk Price (+10 carton)"]

        for i, header in enumerate(headers):
            align = "L" if i == 0 else "C"
            self.cell(col_widths[i], 10, header, border=1, align=align, fill=True)
        self.ln()

        self.set_text_color(0, 0, 0)

    def add_product_row(self, product_name: str, unit_price: float | None, bulk_price: float | None):
        """Add a single product row."""
        self.set_font("Helvetica", "", 10)
        col_widths = [100, 40, 50]

        self.cell(col_widths[0], 8, product_name, border=1)
        self.cell(col_widths[1], 8, format_currency(unit_price) if unit_price else "", border=1, align="C")
        self.cell(col_widths[2], 8, format_currency(bulk_price) if bulk_price else "", border=1, align="C")
        self.ln()


def format_currency(amount: float | Decimal | None) -> str:
    """Format amount as currency."""
    if amount is None:
        return ""
    return f"${float(amount):,.2f}"


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


def generate_price_list_pdf(products: list[dict]) -> bytes:
    """Generate the price list PDF and return as bytes."""
    pdf = PriceListPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.add_title()
    pdf.add_table_header()

    for product in products:
        # Check for page break
        if pdf.get_y() > 270:
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
