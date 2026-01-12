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
from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

# Import PDF generator
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
sys.path.insert(0, str(Path(__file__).parent.parent))
from generate_statement_pdf import fetch_statement_data, StatementPDF, format_currency
from src.reporting.sales_report import process_queue

# Load environment
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path, override=True)

app = FastAPI(
    title="Statement PDF API",
    description="Generate PDF statements for merchants",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
