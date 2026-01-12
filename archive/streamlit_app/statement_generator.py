"""PDF statement generator for customer invoices."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Dict

import pandas as pd
from fpdf import FPDF
from fpdf.enums import XPos, YPos

logger = logging.getLogger(__name__)


# Aging bucket constants - must match values in mart.vw_statement_details
@dataclass(frozen=True)
class AgingBuckets:
    """Aging bucket labels and display names."""

    CURRENT: str = "current"
    DAYS_1_30: str = "1-30"
    DAYS_31_60: str = "31-60"
    DAYS_61_90: str = "61-90"
    OVER_90: str = "90+"

    @classmethod
    def display_labels(cls) -> Dict[str, str]:
        """Return mapping of bucket keys to display labels."""
        return {
            cls.CURRENT: "Current",
            cls.DAYS_1_30: "1-30 Days Past Due",
            cls.DAYS_31_60: "31-60 Days Past Due",
            cls.DAYS_61_90: "61-90 Days Past Due",
            cls.OVER_90: "Over 90 Days Past Due",
        }


AGING_BUCKETS = AgingBuckets()


def sanitize_filename(name: str) -> str:
    """Sanitize a string to be safe for use as a filename.

    Args:
        name: The string to sanitize.

    Returns:
        A sanitized string containing only alphanumeric characters, hyphens,
        and underscores.
    """
    # Remove any path separators and other unsafe characters
    safe_name = re.sub(r'[^\w\s-]', '', name)
    # Replace spaces with underscores
    safe_name = re.sub(r'\s+', '_', safe_name)
    # Limit length to prevent filesystem issues
    return safe_name[:100] if safe_name else "unknown"


def generate_statement_pdf(statement_data: pd.DataFrame) -> bytes:
    """Generate a PDF statement from a DataFrame.

    Args:
        statement_data: DataFrame containing statement details with columns:
            - merchant_group: Parent customer name
            - customer_name: Branch/child customer name
            - bill_to: Billing address
            - head_office_address: Merchant group billing address
            - invoice_number: Invoice identifier
            - invoice_date: Date of invoice
            - outstanding_amount: Amount due
            - aging_bucket: Aging category

    Returns:
        PDF document as bytes.

    Raises:
        ValueError: If required columns are missing from statement_data.
        RuntimeError: If PDF generation fails.
    """
    required_columns = {
        "merchant_group",
        "customer_name",
        "bill_to",
        "head_office_address",
        "invoice_number",
        "invoice_date",
        "outstanding_amount",
        "aging_bucket",
    }
    missing_columns = required_columns - set(statement_data.columns)
    if missing_columns:
        raise ValueError(f"Missing required columns: {missing_columns}")

    if statement_data.empty:
        raise ValueError("Cannot generate statement from empty data")

    try:
        pdf = FPDF()
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 16)
        pdf.cell(0, 10, "Statement", border=0, align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(10)

        # Customer details
        parent_customer = str(statement_data["merchant_group"].iloc[0])
        head_office_address = str(statement_data["head_office_address"].iloc[0] or "")
        if not head_office_address:
            head_office_address = str(statement_data["bill_to"].iloc[0] or "")
        pdf.set_font("Helvetica", "", 12)
        pdf.cell(0, 10, f"To: {parent_customer}", border=0, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if head_office_address:
            pdf.multi_cell(0, 10, head_office_address)
        pdf.ln(10)

        # Statement table header
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(30, 10, "Date", 1)
        pdf.cell(40, 10, "Transaction", 1)
        pdf.cell(30, 10, "Amount", 1)
        pdf.cell(30, 10, "Balance", 1)
        pdf.ln()

        # Process each branch with its own running balance
        pdf.set_font("Helvetica", "", 12)
        grand_total = 0.0

        for branch, group in statement_data.groupby("customer_name", sort=True):
            # Branch header
            pdf.set_font("Helvetica", "B", 12)
            pdf.cell(0, 10, str(branch), border=0, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_font("Helvetica", "", 12)

            # Reset balance for each branch
            branch_balance = 0.0

            for _, row in group.iterrows():
                amount = float(row["outstanding_amount"] or 0)
                branch_balance += amount
                grand_total += amount

                invoice_date = str(row["invoice_date"])
                invoice_number = str(row["invoice_number"] or "")

                pdf.cell(30, 10, invoice_date, 1)
                pdf.cell(40, 10, invoice_number[:15], 1)  # Truncate long invoice numbers
                pdf.cell(30, 10, f"${amount:,.2f}", 1)
                pdf.cell(30, 10, f"${branch_balance:,.2f}", 1)
                pdf.ln()

        # Aging summary
        pdf.ln(10)
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 10, "Aging Summary", border=0, align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(5)

        aging_buckets = statement_data.groupby("aging_bucket")["outstanding_amount"].sum()
        total_due = aging_buckets.sum()

        display_labels = AGING_BUCKETS.display_labels()
        bucket_order = [
            AGING_BUCKETS.CURRENT,
            AGING_BUCKETS.DAYS_1_30,
            AGING_BUCKETS.DAYS_31_60,
            AGING_BUCKETS.DAYS_61_90,
            AGING_BUCKETS.OVER_90,
        ]

        for bucket_key in bucket_order:
            display_label = display_labels.get(bucket_key, bucket_key)
            amount = float(aging_buckets.get(bucket_key, 0))
            pdf.cell(50, 10, display_label, 1)
            pdf.cell(40, 10, f"${amount:,.2f}", 1)
            pdf.ln()

        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(50, 10, "Total Amount Due", 1)
        pdf.cell(40, 10, f"${total_due:,.2f}", 1)

        # fpdf2 returns bytearray directly, convert to bytes
        return bytes(pdf.output())

    except Exception as e:
        logger.error(f"Failed to generate PDF statement: {e}")
        raise RuntimeError(f"PDF generation failed: {e}") from e
