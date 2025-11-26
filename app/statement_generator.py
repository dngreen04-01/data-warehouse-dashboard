from __future__ import annotations

import pandas as pd
from fpdf import FPDF


def generate_statement_pdf(statement_data: pd.DataFrame) -> bytes:
    """Generate a PDF statement from a DataFrame."""
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Arial", "B", 16)
    pdf.cell(0, 10, "Statement", 0, 1, "C")
    pdf.ln(10)

    # Customer details
    parent_customer = statement_data["merchant_group"].iloc[0]
    bill_to = statement_data["bill_to"].iloc[0]
    pdf.set_font("Arial", "", 12)
    pdf.cell(0, 10, f"To: {parent_customer}", 0, 1)
    pdf.multi_cell(0, 10, bill_to)
    pdf.ln(10)

    # Statement table
    pdf.set_font("Arial", "B", 12)
    pdf.cell(30, 10, "Date", 1)
    pdf.cell(40, 10, "Transaction", 1)
    pdf.cell(30, 10, "Amount", 1)
    pdf.cell(30, 10, "Balance", 1)
    pdf.ln()

    pdf.set_font("Arial", "", 12)
    balance = 0
    for branch, group in statement_data.groupby("customer_name"):
        pdf.set_font("Arial", "B", 12)
        pdf.cell(0, 10, branch, 0, 1)
        pdf.set_font("Arial", "", 12)
        for _, row in group.iterrows():
            balance += row["outstanding_amount"]
            pdf.cell(30, 10, str(row["invoice_date"]), 1)
            pdf.cell(40, 10, row["invoice_number"], 1)
            pdf.cell(30, 10, f'${row["outstanding_amount"]:,.2f}', 1)
            pdf.cell(30, 10, f'${balance:,.2f}', 1)
            pdf.ln()

    # Aging summary
    pdf.ln(10)
    pdf.set_font("Arial", "B", 12)
    pdf.cell(0, 10, "Aging Summary", 0, 1, "C")
    pdf.ln(5)

    aging_buckets = statement_data.groupby("aging_bucket")["outstanding_amount"].sum()
    total_due = aging_buckets.sum()

    pdf.cell(40, 10, "Current", 1)
    pdf.cell(40, 10, f'${aging_buckets.get("current", 0):,.2f}', 1)
    pdf.ln()
    pdf.cell(40, 10, "1-30 Days Past Due", 1)
    pdf.cell(40, 10, f'${aging_buckets.get("1-30", 0):,.2f}', 1)
    pdf.ln()
    pdf.cell(40, 10, "31-60 Days Past Due", 1)
    pdf.cell(40, 10, f'${aging_buckets.get("31-60", 0):,.2f}', 1)
    pdf.ln()
    pdf.cell(40, 10, "61-90 Days Past Due", 1)
    pdf.cell(40, 10, f'${aging_buckets.get("61-90", 0):,.2f}', 1)
    pdf.ln()
    pdf.cell(40, 10, "Over 90 Days Past Due", 1)
    pdf.cell(40, 10, f'${aging_buckets.get("90+", 0):,.2f}', 1)
    pdf.ln()
    pdf.set_font("Arial", "B", 12)
    pdf.cell(40, 10, "Total Amount Due", 1)
    pdf.cell(40, 10, f"${total_due:,.2f}", 1)

    return pdf.output(dest="S").encode("latin-1")
