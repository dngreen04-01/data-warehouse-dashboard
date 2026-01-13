# Data Warehouse Project Guidelines

## Database Schema

**IMPORTANT**: All data warehouse tables are in the `dw` schema, NOT the public schema.

### Backend (Python/psycopg)
Always use the fully qualified table name with the `dw.` prefix:
```python
# CORRECT
cur.execute("SELECT * FROM dw.dim_product WHERE ...")
cur.execute("INSERT INTO dw.production_conversion (...) VALUES (...)")

# WRONG - will fail
cur.execute("SELECT * FROM dim_product WHERE ...")
```

### Frontend (Supabase JS Client)
Always specify the schema using `.schema('dw')`:
```typescript
// CORRECT
const { data } = await supabase
    .schema('dw')
    .from('dim_product')
    .select('*')

// WRONG - will query public schema
const { data } = await supabase
    .from('dim_product')
    .select('*')
```

### Key Tables
- `dw.dim_product` - Product dimension (items from Xero)
- `dw.dim_customer` - Customer dimension
- `dw.fct_sales_line` - Sales transaction lines
- `dw.fct_invoice` - Invoice headers
- `dw.production_conversion` - Manufacturing conversion history
- `dw.xero_tokens` - Encrypted Xero OAuth tokens

## Xero Integration

### OAuth Scopes
The default scopes are read-only. To create invoices/credit notes (e.g., for inventory adjustments), add write scope:
```
XERO_SCOPES="accounting.transactions accounting.transactions.read accounting.contacts.read accounting.settings.read"
```

### Inventory Adjustments
- **Decrease stock**: Create Credit Note (ACCPAYCREDIT) to contact "Inventory Adjustments"
- **Increase stock**: Create Invoice (ACCPAY) to contact "Inventory Adjustments"
- Adjustment account code: `x100`
- Inventory asset account: stored in `inventory_asset_account_code` field on dim_product

## Project Structure

```
/api/main.py           - FastAPI backend
/frontend/src/         - React frontend
/src/ingestion/        - ETL scripts (Xero sync, etc.)
/supabase/migrations/  - Database migrations
/scripts/              - Utility scripts
```

## Running Locally

```bash
# Backend API
uvicorn api.main:app --reload --port 8001

# Frontend
cd frontend && npm run dev
```
