from __future__ import annotations

import os
import sys
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv

# Add the app directory to the Python path
sys.path.append(str(Path(__file__).parent.parent / "app"))

import pendulum

from data_access import fetch_reference_data, fetch_statement_data
from statement_generator import generate_statement_pdf


def is_second_working_day() -> bool:
    """Check if today is the second working day of the month."""
    today = pendulum.now("UTC")
    start_of_month = today.start_of("month")
    working_days = 0
    for day in pendulum.period(start_of_month, today):
        if day.is_weekday():
            working_days += 1
    return working_days == 2 and today.is_weekday()


def main():
    """Generate monthly statements for all parent customers."""
    if not is_second_working_day():
        print("Not the second working day of the month. Exiting.")
        return

    load_dotenv()
    output_dir = Path("statements")
    output_dir.mkdir(exist_ok=True)

    parent_customers = fetch_reference_data()["merchant_groups"]["merchant_group"].tolist()

    for parent_customer in parent_customers:
        statement_data = fetch_statement_data(parent_customer)
        if not statement_data.empty:
            pdf_bytes = generate_statement_pdf(statement_data)
            output_path = output_dir / f"statement_{parent_customer}.pdf"
            with open(output_path, "wb") as f:
                f.write(pdf_bytes)
            print(f"Generated statement for {parent_customer} at {output_path}")
        else:
            print(f"No outstanding invoices for {parent_customer}")


if __name__ == "__main__":
    main()
