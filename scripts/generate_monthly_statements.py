#!/usr/bin/env python3
"""Generate monthly customer statements for all parent customers.

This script is designed to run as a scheduled GitHub Action on the 2nd working
day of each month. It generates PDF statements for all parent customers with
outstanding invoices.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

import pendulum
from dotenv import load_dotenv

# Add the app directory to the Python path
APP_DIR = Path(__file__).parent.parent / "app"
sys.path.insert(0, str(APP_DIR))

from data_access import fetch_reference_data, fetch_statement_data  # noqa: E402
from statement_generator import generate_statement_pdf, sanitize_filename  # noqa: E402

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)
logger = logging.getLogger(__name__)


def is_second_working_day() -> bool:
    """Check if today is the second working day of the month.

    Returns:
        True if today is the 2nd working day (Monday-Friday) of the current month.
    """
    today = pendulum.now("UTC")
    start_of_month = today.start_of("month")
    working_days = 0

    # Iterate from start of month to today (inclusive)
    current = start_of_month
    while current <= today:
        if current.weekday() < 5:  # Monday=0 to Friday=4
            working_days += 1
            if working_days > 2:
                # Early exit - we've passed the 2nd working day
                return False
        current = current.add(days=1)

    return working_days == 2 and today.weekday() < 5


def main() -> int:
    """Generate monthly statements for all parent customers.

    Returns:
        Exit code: 0 for success, 1 for failure.
    """
    # Check if we should run today
    if not is_second_working_day():
        logger.info("Not the second working day of the month. Exiting.")
        return 0

    # Load environment variables
    load_dotenv()

    # Create output directory
    output_dir = Path("statements")
    output_dir.mkdir(exist_ok=True)

    # Track results
    generated_count = 0
    error_count = 0
    skipped_count = 0

    try:
        # Fetch all parent customers
        reference_data = fetch_reference_data()
        merchant_groups = reference_data.get("merchant_groups")

        if merchant_groups is None or merchant_groups.empty:
            logger.warning("No merchant groups found in reference data.")
            return 0

        parent_customers = merchant_groups["merchant_group"].dropna().tolist()
        logger.info(f"Processing {len(parent_customers)} parent customers")

        for parent_customer in parent_customers:
            try:
                statement_data = fetch_statement_data(parent_customer)

                if statement_data.empty:
                    logger.info(f"No outstanding invoices for {parent_customer}")
                    skipped_count += 1
                    continue

                # Generate PDF
                pdf_bytes = generate_statement_pdf(statement_data)

                # Use sanitized filename to prevent path injection
                safe_name = sanitize_filename(parent_customer)
                output_path = output_dir / f"statement_{safe_name}.pdf"

                with open(output_path, "wb") as f:
                    f.write(pdf_bytes)

                logger.info(f"Generated statement for {parent_customer} at {output_path}")
                generated_count += 1

            except Exception as e:
                logger.error(f"Failed to generate statement for {parent_customer}: {e}")
                error_count += 1

    except Exception as e:
        logger.error(f"Fatal error during statement generation: {e}")
        return 1

    # Summary
    logger.info(
        f"Statement generation complete: "
        f"{generated_count} generated, {skipped_count} skipped, {error_count} errors"
    )

    # Return error code if any statements failed
    return 1 if error_count > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
