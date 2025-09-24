# Unified Sales & Operations Warehouse

This repository delivers the Supabase-backed warehouse, ingestion code, and analytics layer required by the Unified Sales & Operations Dashboard PRD. Historical Reckon CSV exports are ingested once, while Xero data lands via a repeatable API sync. Reporting views hydrate an open-source BI layer for self-service insights.

## Architecture Overview
- **Supabase Postgres** stores harmonised dimensions (`dw.dim_customer`, `dw.dim_product`), facts (`dw.fct_sales_line`, `dw.fct_invoice`), and lightweight orchestration tables (`dw.etl_run_log`, `dw.sync_state`).
- **Historical loader** (`src/ingestion/load_historical.py`) upserts the provided CSV extracts and customer clusters into Supabase.
- **Incremental sync** (`src/ingestion/sync_xero.py`) refreshes invoices/line items from the Xero API, auto-registering unseen products and tracking last successful run.
- **Analytics schema** (`supabase/views.sql`) furnishes enriched datasets for BI tooling: daily KPIs, dimensional breakdowns, and freshness monitors.
- **Supabase functions & triggers** (`supabase/functions.sql`) keep `updated_at` fields in sync and centralise ETL run logging for observability.

## Getting Started
1. **Install prerequisites**
   - Python 3.11+
   - `pip install -r requirements.txt`
   - Supabase project with database credentials (service-role key or direct connection string)
2. **Configure environment**
   - Copy `.env.example` to `.env`
   - Populate `SUPABASE_CONNECTION_STRING`
   - Add Xero OAuth2 credentials (`XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REFRESH_TOKEN`, `XERO_TENANT_ID`) for incremental syncs
3. **Provision database objects**
   ```bash
   psql "$SUPABASE_CONNECTION_STRING" -f supabase/schema.sql
   psql "$SUPABASE_CONNECTION_STRING" -f supabase/functions.sql
   psql "$SUPABASE_CONNECTION_STRING" -f supabase/views.sql
   ```
4. **Load historical data**
   ```bash
   python -m src.ingestion.load_historical
   ```
5. **Run Xero incremental sync (on demand or via scheduler)**
   ```bash
   python -m src.ingestion.sync_xero
   ```
   - Schedule via cron, GitHub Actions, or a workflow orchestrator (Prefect/Airflow) for daily execution.


## Analytics Web App
- Launch a combined dashboard and admin UI with `streamlit run app/app.py`.
- Sidebar filters cover customer, parent, cluster, market, product group, individual product, and a custom date range.
- KPI cards show WTD/MTD/YTD revenue vs prior-year; interactive Plotly charts compare sales over time and provide breakdowns by market, parent customer, product group, and cluster.
- Tables surface top products/customers/parent customers and a downloadable transaction-level detail grid.
- Admin tabs support adding or updating customers and products directly in Supabase (IDs auto-increment when creating new records).
- The app reuses the `.env` Supabase connection string—ensure it is populated before running.

## Operational Notes
- `dw.etl_run_log` captures status, row counts, and errors for each pipeline run; surface `mart.data_freshness` on the dashboard for transparency.
- `dw.sync_state` records the last synced invoice date to enable incremental API pulls.
- New Xero product codes are auto-seeded into `dw.dim_product`; review and enrich them (pricing, category) inside Supabase as needed.
- Customer clusters load alongside customers; edit or re-seed `customer_clusters.csv` and rerun the historical loader to update assignments.

## Building the Dashboard (Open Source Options)
A Supabase stack pairs well with modern open-source BI platforms. Recommended choices:

| Tool | Strengths | Fit for PRD |
| --- | --- | --- |
| **Metabase** | Fast setup, user-friendly filters, Pulses for alerts | Ideal for first release; supports date comparisons and drill-through tables |
| **Apache Superset** | Rich visualisations, row-level security, SQL Lab | Great when advanced custom charts or role-based access are required |
| **Lightdash** | dbt-native metrics layer, semantic governance | Strong option if you later adopt dbt for transformations |
| **Redash** | Lightweight SQL editor with dashboarding | Useful for analyst-driven questions and quick ad-hoc reports |

Any of these tools can connect directly to Supabase Postgres. Configure data sources using the Supabase host, database, and service-role credentials. Reuse the provided `mart` views to drive:
- Global filters (customer, parent customer, cluster, market, product category, date range)
- Comparative KPIs (YTD/MTD/WTD vs prior year from `mart.kpi_period_comparison`)
- Top performer tables (query `mart.sales_enriched` with appropriate ordering)
- Transaction-level drilldowns (select from `mart.sales_enriched` or `dw.fct_sales_line`)

## Next Steps & Extensions
- Wrap ingestion scripts with Prefect or Airflow DAGs for scheduling, retries, and alerting.
- Swap the ad-hoc SQL views for a dbt Core project once modelling complexity grows.
- Integrate Supabase Row Level Security if the dashboard will serve different audiences with scoped data access.
- Extend the warehouse for roadmap phases (forward orders, budgets) by adding new fact tables under the same `dw` schema.

## Validation Checklist
- [ ] Supabase schemas applied successfully
- [ ] Historical CSV load runs without errors and populates `dw.dim_*` and `dw.fct_*`
- [ ] Xero sync completes with `dw.sync_state.last_success_at` updated
- [ ] BI tool connected and filters/KPIs sourced from `mart` views
