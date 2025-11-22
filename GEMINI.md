# Unified Sales & Operations Warehouse

## Project Overview
This project is a data warehouse and analytics platform designed to unify sales and operations data. It consolidates historical data from **Reckon** (via CSV) and ongoing data from **Xero** (via API) into a **Supabase (PostgreSQL)** database. A **Streamlit** web application serves as the frontend for visualization, reporting, and basic data management (CRUD for Customers/Products).

## Tech Stack
*   **Language:** Python 3.11+
*   **Database:** Supabase (PostgreSQL)
*   **Frontend:** Streamlit
*   **Visualization:** Plotly
*   **Data Processing:** Pandas
*   **Infrastructure:** Docker (implied potential), Cloud-hosted (Supabase)

## Architecture
1.  **Ingestion Layer (`src/ingestion/`)**:
    *   `load_historical.py`: One-time loader for historical Reckon CSV data.
    *   `sync_xero.py`: Incremental sync script for Xero API data.
2.  **Storage Layer (Supabase)**:
    *   **`dw` Schema:** The core Data Warehouse containing dimension (`dim_`) and fact (`fct_`) tables.
    *   **`mart` Schema:** Analytics-ready views for consumption by the dashboard.
    *   **`raw` Schema:** Landing area for raw data (if used).
    *   `etl_run_log` & `sync_state`: Operational tables for tracking pipeline health.
3.  **Presentation Layer (`app/`)**:
    *   `app.py`: The main Streamlit application entry point.
    *   `data_access.py`: Abstraction layer for database queries.

## Setup & Usage

### Prerequisites
*   Python 3.11+
*   Supabase project credentials
*   Xero API credentials (for incremental sync)

### Installation
```bash
pip install -r requirements.txt
```

### Environment Configuration
Create a `.env` file (copy from `.env.example` if available) with:
*   `SUPABASE_CONNECTION_STRING`
*   `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, `XERO_TENANT_ID`

### Database Initialization
Run the SQL scripts against your Supabase instance:
```bash
psql "$SUPABASE_CONNECTION_STRING" -f supabase/schema.sql
psql "$SUPABASE_CONNECTION_STRING" -f supabase/functions.sql
psql "$SUPABASE_CONNECTION_STRING" -f supabase/views.sql
```

### Data Loading
1.  **Historical Load:**
    ```bash
    python -m src.ingestion.load_historical
    ```
2.  **Xero Sync:**
    ```bash
    python -m src.ingestion.sync_xero
    ```

### Running the Dashboard
```bash
streamlit run app/app.py
```

## Key Files
*   `README.md`: Primary documentation and setup guide.
*   `PRD.md`: Product Requirements Document detailing business logic and goals.
*   `app/app.py`: Main dashboard application.
*   `src/ingestion/load_historical.py`: Logic for processing historical CSVs.
*   `supabase/schema.sql`: Definition of the `dw` schema and tables.
*   `supabase/views.sql`: Definition of the `mart` views.

## Development Conventions
*   **Code Style:** Follows standard Python PEP 8 conventions.
*   **Database Naming:**
    *   Schemas: `dw`, `mart`, `raw`.
    *   Tables: `dim_[entity]`, `fct_[event]`.
*   **Testing:** `pytest` is included in requirements, implying a test suite should be maintained (check `tests/` if it exists, or create it).
*   **Modularity:** Keep ingestion logic in `src/ingestion` and UI logic in `app/`. Database access should go through `app/data_access.py` for the UI.
