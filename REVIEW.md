# Code, Logic, and Architecture Review

## Overview
I have reviewed the application code, logic, and architecture against the requirements for the "Unified Sales & Operations Dashboard".

## 1. Code Review
- **Code Quality:** The Python code (`app/app.py`, `src/ingestion/*.py`) is clean, well-structured, and follows standard practices.
- **Logic:**
    - `load_historical.py`: The logic for loading historical CSV data is sound. However, it relies on specific filenames (`dim_customer2.csv`, `dim_product4.csv`, etc.).
    - `sync_xero.py`: The logic correctly fetches invoices from Xero and tracks the sync state using `dw.sync_state`.
    - `app/app.py`: The Streamlit application logic for visualizations (YTD, MTD, YoY comparisons) appears correct and uses the `mart` views appropriately.
- **Testing:**
    - I verified that the scripts parse and run (up to the point of DB connection) in a clean environment.

## 2. Architecture Review
- **Database:** The Supabase (PostgreSQL) schema with `dw` (Data Warehouse) and `mart` (Data Mart/Views) layers is a robust design for this scale.
- **Ingestion:**
    - **Historical:** The one-off historical load via script is appropriate.
    - **Xero Sync:** The incremental sync strategy using `modified_since` is efficient.
- **Frontend:** Streamlit is an excellent choice for rapid development of internal data tools.

## 3. Critical Findings & Actions Taken

### Missing CSV Files
The historical data ingestion script (`src/ingestion/load_historical.py`) expects the following files in the repository root:
- `dim_customer2.csv`
- `dim_product4.csv`
- `fct_invoice_clean.csv`
- `fct_sales_line_clean1.csv`
- `customer_clusters.csv`
- `Cluster_Summary.csv`

**Status:** These files are currently **missing** from the repository. I used `find` to search for them recursively but they were not found.
**Action Required:** Please upload these files to the root of the repository so the historical data can be loaded.

### Automated Xero Sync
**Requirement:** "Data needs to be loaded from Xero via webhook ideally or daily API."
**Finding:** The `src/ingestion/sync_xero.py` script existed but was not scheduled. Also, the original script relied solely on environment variables for Xero tokens, which would cause the automation to break once the refresh token expired (token rotation was not persisted).
**Action Taken:**
1.  **Scheduled Job:** I created a GitHub Actions workflow (`.github/workflows/sync_xero.yaml`) to run the sync script daily at 01:00 UTC.
2.  **Token Rotation Fix:** I updated `src/ingestion/sync_xero.py` to store and retrieve Xero OAuth2 tokens from a new database table `dw.xero_tokens`.
3.  **Schema Update:** I added the `dw.xero_tokens` table to `supabase/schema.sql`.

**How it works now:**
- On the first run, the script uses the `XERO_REFRESH_TOKEN` from GitHub Secrets (env vars).
- After refreshing the token, it saves the *new* refresh token to the database (`dw.xero_tokens`).
- On subsequent runs, it prioritizes the token from the database.
- This ensures the daily sync continues to work indefinitely without manual intervention, provided the initial secret is valid.

## 4. Future Phases
The code is well-positioned for the future phases (Forecasting, Ordering) as the database schema is extensible.
