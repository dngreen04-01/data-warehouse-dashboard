"""
PDF Statement Generator for Merchant Statements

Generates consolidated statements in the same format as Xero statements:
- Header with merchant name and head office address
- Invoices grouped by branch/customer
- Running balance per branch
- Aging summary at the bottom
"""

import os
import re
import sys
from datetime import datetime
from pathlib import Path
from decimal import Decimal

import psycopg
from dotenv import load_dotenv
from fpdf import FPDF


STATEMENT_FROM_LINES = [
    "Akina Trading Limited T/A Klipon",
    "P O Box 4120",
    "Mt Maunganui",
    "New Zealand",
]
BANK_DETAILS_LINE = "Please remit payment to - Akina Trading Ltd: 06-0738-0387563-000"


class StatementPDF(FPDF):
    """Custom PDF class for statement generation."""

    def __init__(self, merchant_name: str, head_office_address: str | None):
        super().__init__()
        self.merchant_name = merchant_name
        self.head_office_address = head_office_address
        self.statement_date = datetime.now().strftime("%d %b %Y")

    def header(self):
        """Add header to each page."""
        page_width = self.w - self.l_margin - self.r_margin
        left_width = page_width * 0.6
        right_width = page_width - left_width
        start_y = self.get_y()
        line_height = 5

        # Statement "from" block (left)
        if STATEMENT_FROM_LINES:
            self.set_xy(self.l_margin, start_y)
            self.set_font("Helvetica", "B", 11)
            self.cell(left_width, line_height, STATEMENT_FROM_LINES[0], new_x="LMARGIN", new_y="NEXT")
            self.set_font("Helvetica", "", 10)
            for line in STATEMENT_FROM_LINES[1:]:
                self.set_x(self.l_margin)
                self.cell(left_width, line_height, line, new_x="LMARGIN", new_y="NEXT")

        # Statement title/date (right)
        self.set_xy(self.l_margin + left_width, start_y)
        self.set_font("Helvetica", "B", 16)
        self.cell(right_width, 7, "Statement", align="R")
        self.set_xy(self.l_margin + left_width, start_y + 7)
        self.set_font("Helvetica", "", 10)
        self.cell(right_width, 5, f"Date: {self.statement_date}", align="R")

        left_height = line_height * len(STATEMENT_FROM_LINES)
        right_height = 12
        self.set_y(start_y + max(left_height, right_height) + 4)

        # To: Merchant info
        self.set_font("Helvetica", "", 10)
        self.cell(0, 5, f"To:", new_x="LMARGIN", new_y="NEXT")
        self.set_font("Helvetica", "B", 11)
        self.cell(0, 5, self.merchant_name, new_x="LMARGIN", new_y="NEXT")

        if self.head_office_address:
            self.set_font("Helvetica", "", 10)
            address_parts = [
                p.strip()
                for p in re.split(r",|\n", self.head_office_address)
                if p.strip()
            ]
            for part in address_parts[:4]:  # Limit to 4 lines
                self.cell(0, 5, part, new_x="LMARGIN", new_y="NEXT")

        self.ln(10)

    def footer(self):
        """Add footer to each page."""
        self.set_y(-25)
        self.set_font("Helvetica", "", 9)
        self.multi_cell(0, 4, BANK_DETAILS_LINE)
        self.set_font("Helvetica", "I", 8)
        self.cell(0, 6, f"Page {self.page_no()}/{{nb}}", align="C")


def format_currency(amount: float | Decimal) -> str:
    """Format amount as NZD currency."""
    if amount is None:
        return "$0.00"
    return f"${float(amount):,.2f}"


def fetch_statement_data(conn, merchant_group: str | None = None) -> dict:
    """
    Fetch statement data from the database.

    Returns dict with structure:
    {
        'merchant_group': {
            'head_office_address': str,
            'branches': {
                'branch_name': [
                    {'invoice_number': str, 'invoice_date': date, 'outstanding_amount': Decimal, ...}
                ]
            },
            'aging_summary': {'current': Decimal, '1-30': Decimal, ...}
        }
    }
    """
    query = """
        SELECT
            merchant_group,
            customer_name,
            head_office_address,
            invoice_number,
            invoice_date,
            outstanding_amount,
            aging_bucket
        FROM mart.vw_statement_details
        WHERE 1=1
    """
    params = []

    if merchant_group:
        query += " AND merchant_group = %s"
        params.append(merchant_group)

    query += " ORDER BY merchant_group, customer_name, invoice_date"

    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    # Process results into grouped structure
    merchants = {}

    for row in rows:
        mg, customer, address, inv_num, inv_date, amount, aging = row
        mg = mg or customer  # Fallback if merchant_group is NULL

        if mg not in merchants:
            merchants[mg] = {
                'head_office_address': address,
                'branches': {},
                'aging_summary': {'current': 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0}
            }

        if customer not in merchants[mg]['branches']:
            merchants[mg]['branches'][customer] = []

        merchants[mg]['branches'][customer].append({
            'invoice_number': inv_num,
            'invoice_date': inv_date,
            'outstanding_amount': float(amount) if amount else 0,
            'aging_bucket': aging
        })

        # Update aging summary
        if aging in merchants[mg]['aging_summary']:
            merchants[mg]['aging_summary'][aging] += float(amount) if amount else 0

    return merchants


def generate_statement_pdf(
    merchant_name: str,
    head_office_address: str | None,
    branches: dict,
    aging_summary: dict,
    output_path: str
) -> str:
    """Generate a PDF statement for a merchant."""

    pdf = StatementPDF(merchant_name, head_office_address)
    pdf.set_auto_page_break(auto=True, margin=25)
    pdf.add_page()

    # Column widths
    page_width = pdf.w - pdf.l_margin - pdf.r_margin
    col_date = 30
    col_amount = 35
    col_balance = 35
    col_transaction = page_width - col_date - col_amount - col_balance

    # Table header function
    def add_table_header():
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_fill_color(240, 240, 240)
        pdf.cell(col_date, 7, "Date", border=1, fill=True)
        pdf.cell(col_transaction, 7, "Transaction", border=1, fill=True)
        pdf.cell(col_amount, 7, "Amount", border=1, align="R", fill=True)
        pdf.cell(col_balance, 7, "Balance", border=1, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")

    # Process each branch
    for branch_name, invoices in sorted(branches.items()):
        # Check if we need a new page (at least 60mm for branch header + some invoices)
        if pdf.get_y() > 230:
            pdf.add_page()

        # Branch header
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_fill_color(220, 220, 220)
        pdf.cell(0, 8, branch_name, border=1, fill=True, new_x="LMARGIN", new_y="NEXT")

        # Table header
        add_table_header()

        # Sort invoices by date
        invoices_sorted = sorted(invoices, key=lambda x: x['invoice_date'])

        # Running balance for this branch
        balance = 0

        pdf.set_font("Helvetica", "", 9)
        for inv in invoices_sorted:
            # Check for page break
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

        # Branch subtotal
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(col_date + col_transaction, 7, f"Balance Due - {branch_name}", border=1)
        pdf.cell(col_amount, 7, "", border=1)
        pdf.cell(col_balance, 7, format_currency(balance), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

        pdf.ln(5)

    # Aging Summary section
    if pdf.get_y() > 200:
        pdf.add_page()

    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 10, "Aging Summary", new_x="LMARGIN", new_y="NEXT")

    # Aging table
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

    # Header row
    for key, label in aging_labels:
        pdf.cell(aging_col_width, 8, label, border=1, align="C", fill=True)
    pdf.cell(aging_col_width, 8, "Total", border=1, align="C", fill=True, new_x="LMARGIN", new_y="NEXT")

    # Values row
    pdf.set_font("Helvetica", "", 10)
    total = 0
    for key, label in aging_labels:
        amount = aging_summary.get(key, 0)
        total += amount
        pdf.cell(aging_col_width, 8, format_currency(amount), border=1, align="R")
    pdf.cell(aging_col_width, 8, format_currency(total), border=1, align="R", new_x="LMARGIN", new_y="NEXT")

    # Grand Total
    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 10, f"Total Outstanding: {format_currency(total)}", align="R", new_x="LMARGIN", new_y="NEXT")

    # Save PDF
    pdf.output(output_path)
    return output_path


def main():
    """Main function to generate statement PDFs."""
    # Load environment variables
    env_path = Path(__file__).parent.parent / ".env"
    load_dotenv(env_path, override=True)

    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        print("Error: SUPABASE_CONNECTION_STRING not found in environment.")
        sys.exit(1)

    # Parse command line args
    merchant_filter = None
    if len(sys.argv) > 1:
        merchant_filter = sys.argv[1]
        print(f"Generating statement for: {merchant_filter}")
    else:
        print("Generating statements for all merchants...")

    # Create output directory
    output_dir = Path(__file__).parent.parent / "output" / "statements"
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        with psycopg.connect(conn_str) as conn:
            merchants = fetch_statement_data(conn, merchant_filter)

            if not merchants:
                print("No statement data found.")
                return

            for merchant_name, data in merchants.items():
                # Sanitize filename
                safe_name = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in merchant_name)
                timestamp = datetime.now().strftime("%Y%m%d")
                output_file = output_dir / f"Statement_{safe_name}_{timestamp}.pdf"

                print(f"Generating: {output_file.name}")

                generate_statement_pdf(
                    merchant_name=merchant_name,
                    head_office_address=data['head_office_address'],
                    branches=data['branches'],
                    aging_summary=data['aging_summary'],
                    output_path=str(output_file)
                )

                # Print summary
                total = sum(data['aging_summary'].values())
                branch_count = len(data['branches'])
                invoice_count = sum(len(invs) for invs in data['branches'].values())
                print(f"  → {invoice_count} invoices from {branch_count} branches")
                print(f"  → Total: {format_currency(total)}")
                print(f"  → Saved to: {output_file}")
                print()

            print("Statement generation complete!")

    except Exception as e:
        print(f"Error generating statements: {e}")
        raise


if __name__ == "__main__":
    main()
