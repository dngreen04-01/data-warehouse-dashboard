# Customer-Specific Price Lists

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with PLANS.md at docs/Plans.md.

## Purpose / Big Picture

After this change, users can create customer-specific price lists that override default product pricing. The user flow is: navigate to a customer, click "Manage Prices", create or edit a price list with custom prices per product, and print a branded PDF price list for that customer. This enables differentiated pricing for export customers versus local customers without changing the master product prices.

To see it working: Go to the Customers page, click "Manage Prices" on a customer row, add products with custom prices, save, then click "Print Price List" to download a PDF showing that customer's specific pricing.

## Progress

- [x] Milestone 1: Database schema for customer price lists
- [x] Milestone 2: Backend API endpoints for price list CRUD and PDF generation
- [x] Milestone 3: Frontend customer list enhancements (price list indicators and actions)
- [x] Milestone 4: Frontend price list editor page

## Surprises & Discoveries

(To be populated during implementation.)

## Decision Log

**2026-01-20 - Sparse Override Storage**: Chose to store only price overrides (not all products) in `customer_price_override`. This reduces storage, simplifies management, and naturally falls back to default prices. Rejected: copying all product prices when creating a list.

**2026-01-20 - Single Active Price List Per Customer**: Enforced one active price list per customer at a time. Simplifies lookup logic and UI. Historical lists are preserved (soft delete via `is_active=false`) for audit purposes.

**2026-01-20 - Effective Dates for Future Invoicing**: Added `effective_from` and `effective_to` columns to support price versioning. When invoicing is implemented, historical prices can be looked up by date.

## Outcomes & Retrospective

**2026-01-20 - Milestone 1 Complete**: Database schema created in migration `20260120_customer_price_lists.sql`. Includes tables, indexes, trigger, view, and RPC functions as specified.

**2026-01-20 - Milestone 2 Complete**: Backend API endpoints implemented in `/api/main.py`. Added 5 endpoints: GET/POST/PUT/DELETE for price list CRUD plus PDF generation. Also added `fetch_customer_products()` and `generate_customer_price_list_pdf()` functions to `/scripts/generate_price_list_pdf.py` for customer-specific PDF generation with Akina Trading branding.

**2026-01-20 - Milestone 3 Complete**: Frontend customer list enhancements implemented in `/frontend/src/pages/Customers.tsx`. Added "Price List" column with Custom/Default indicator badges, replaced single edit button with dropdown menu containing "Edit Details", "Manage Prices", and "Print Price List" actions. Created migration `/supabase/migrations/20260120_add_price_list_to_customers_rpc.sql` to update `get_customers_with_clusters` RPC to include `has_custom_price_list` field.

**2026-01-20 - Milestone 4 Complete**: Frontend price list editor page implemented in `/frontend/src/pages/CustomerPriceList.tsx`. Added route `/customers/:customerId/prices` in `/frontend/src/App.tsx`. Features include: product search with dropdown, editable price table with custom price and bulk price inputs, save functionality (creates new or updates existing price list), print PDF button, back navigation to customers list, and visual indicators for new/unsaved items.

## Context and Orientation

This project is a data warehouse application with a FastAPI backend (`/api/main.py`), React frontend (`/frontend/src/`), and PostgreSQL database via Supabase. All data warehouse tables reside in the `dw` schema.

**Current Pricing Architecture**:
- `dw.dim_product` contains product-level pricing fields: `price` (synced from Xero), `price_list_price` (custom override for exports), and `bulk_price` (10+ carton orders)
- The existing price list PDF generator (`/scripts/generate_price_list_pdf.py`) creates a generic price list from product-level prices
- There is no customer-specific pricing capability

**Key Existing Files**:
- `/api/main.py` - FastAPI backend (1,128 lines) with endpoints for statements, price lists, manufacturing, users
- `/frontend/src/pages/Customers.tsx` - Customer list page with edit modal
- `/frontend/src/pages/Products.tsx` - Product list with pricing section in edit modal
- `/scripts/generate_price_list_pdf.py` - PDF generator using FPDF with Akina Trading branding
- `/supabase/migrations/` - Database migrations

**Database Tables Referenced**:
- `dw.dim_product` - Product dimension with `product_id` (bigint PK), `product_code`, `item_name`, `price`, `price_list_price`, `bulk_price`
- `dw.dim_customer` - Customer dimension with `customer_id` (text PK), `customer_name`, `merchant_group`, `market`, `archived`

## Milestone 1: Database Schema for Customer Price Lists

### Goal

Create the database tables, views, and functions needed to store and query customer-specific price overrides. At the end of this milestone, the schema exists and can store customer price lists with product-specific overrides.

### Prerequisites

- Access to Supabase project
- Ability to run migrations in `/supabase/migrations/`

### Context for This Milestone

The `dw` schema contains all data warehouse tables. We need two new tables:

1. `dw.customer_price_list` - Header table linking a price list to a customer
2. `dw.customer_price_override` - Line items storing individual product price overrides

We also need a helper view for easy price lookup and an RPC function for the frontend.

### Work

Create a new migration file at `/supabase/migrations/20260120_customer_price_lists.sql` with the following content:

**1. Create the price list header table**:
```sql
CREATE TABLE dw.customer_price_list (
    price_list_id serial PRIMARY KEY,
    customer_id text NOT NULL REFERENCES dw.dim_customer(customer_id),
    name text NOT NULL DEFAULT 'Custom Prices',
    description text,
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_customer_price_list_customer ON dw.customer_price_list(customer_id);
CREATE INDEX idx_customer_price_list_active ON dw.customer_price_list(customer_id, is_active)
    WHERE is_active = true;
```

**2. Create the price override table**:
```sql
CREATE TABLE dw.customer_price_override (
    override_id serial PRIMARY KEY,
    price_list_id integer NOT NULL REFERENCES dw.customer_price_list(price_list_id) ON DELETE CASCADE,
    product_id bigint NOT NULL REFERENCES dw.dim_product(product_id),
    custom_price numeric(18,2) NOT NULL,
    custom_bulk_price numeric(18,2),
    notes text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT unique_product_per_list UNIQUE (price_list_id, product_id)
);

CREATE INDEX idx_customer_price_override_list ON dw.customer_price_override(price_list_id);
CREATE INDEX idx_customer_price_override_product ON dw.customer_price_override(product_id);
```

**3. Add flag to dim_customer for quick lookup**:
```sql
ALTER TABLE dw.dim_customer
ADD COLUMN IF NOT EXISTS has_custom_price_list boolean DEFAULT false;
```

**4. Create trigger to maintain the flag**:
```sql
CREATE OR REPLACE FUNCTION dw.update_customer_price_list_flag()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE dw.dim_customer
        SET has_custom_price_list = EXISTS (
            SELECT 1 FROM dw.customer_price_list
            WHERE customer_id = NEW.customer_id AND is_active = true
        )
        WHERE customer_id = NEW.customer_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE dw.dim_customer
        SET has_custom_price_list = EXISTS (
            SELECT 1 FROM dw.customer_price_list
            WHERE customer_id = OLD.customer_id AND is_active = true
        )
        WHERE customer_id = OLD.customer_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_customer_price_list_flag
AFTER INSERT OR UPDATE OR DELETE ON dw.customer_price_list
FOR EACH ROW EXECUTE FUNCTION dw.update_customer_price_list_flag();
```

**5. Create helper view for effective price lookup**:
```sql
CREATE OR REPLACE VIEW dw.vw_customer_product_price AS
SELECT
    c.customer_id,
    c.customer_name,
    p.product_id,
    p.product_code,
    p.item_name,
    p.price as default_price,
    p.price_list_price as default_price_list_price,
    p.bulk_price as default_bulk_price,
    cpl.price_list_id,
    cpl.name as price_list_name,
    cpo.custom_price,
    cpo.custom_bulk_price,
    COALESCE(cpo.custom_price, p.price_list_price, p.price) as effective_price,
    COALESCE(cpo.custom_bulk_price, p.bulk_price) as effective_bulk_price,
    CASE WHEN cpo.override_id IS NOT NULL THEN true ELSE false END as has_custom_price
FROM dw.dim_customer c
CROSS JOIN dw.dim_product p
LEFT JOIN dw.customer_price_list cpl ON cpl.customer_id = c.customer_id
    AND cpl.is_active = true
    AND cpl.effective_to IS NULL
LEFT JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
    AND cpo.product_id = p.product_id
WHERE p.archived = false
  AND p.is_tracked_as_inventory = true
  AND c.archived = false;
```

**6. Create RPC function for frontend**:
```sql
CREATE OR REPLACE FUNCTION public.get_customer_price_list(p_customer_id text)
RETURNS TABLE (
    price_list_id integer,
    name text,
    description text,
    effective_from date,
    override_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT
        cpl.price_list_id,
        cpl.name,
        cpl.description,
        cpl.effective_from,
        COUNT(cpo.override_id) as override_count
    FROM dw.customer_price_list cpl
    LEFT JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
    WHERE cpl.customer_id = p_customer_id
      AND cpl.is_active = true
      AND cpl.effective_to IS NULL
    GROUP BY cpl.price_list_id, cpl.name, cpl.description, cpl.effective_from;
$$;
```

**7. Create price lookup function for future invoicing**:
```sql
CREATE OR REPLACE FUNCTION dw.get_customer_price(
    p_customer_id text,
    p_product_id bigint,
    p_quantity integer DEFAULT 1
)
RETURNS TABLE (
    unit_price numeric,
    price_source text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_custom_price numeric;
    v_custom_bulk_price numeric;
    v_default_price numeric;
    v_default_bulk_price numeric;
    v_price_list_price numeric;
BEGIN
    SELECT cpo.custom_price, cpo.custom_bulk_price
    INTO v_custom_price, v_custom_bulk_price
    FROM dw.customer_price_list cpl
    JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
    WHERE cpl.customer_id = p_customer_id
      AND cpl.is_active = true
      AND cpl.effective_to IS NULL
      AND cpo.product_id = p_product_id;

    SELECT p.price, p.bulk_price, p.price_list_price
    INTO v_default_price, v_default_bulk_price, v_price_list_price
    FROM dw.dim_product p
    WHERE p.product_id = p_product_id;

    IF v_custom_price IS NOT NULL THEN
        IF p_quantity >= 10 AND v_custom_bulk_price IS NOT NULL THEN
            RETURN QUERY SELECT v_custom_bulk_price, 'custom_bulk'::text;
        ELSE
            RETURN QUERY SELECT v_custom_price, 'custom'::text;
        END IF;
    ELSIF v_price_list_price IS NOT NULL THEN
        IF p_quantity >= 10 AND v_default_bulk_price IS NOT NULL THEN
            RETURN QUERY SELECT v_default_bulk_price, 'price_list_bulk'::text;
        ELSE
            RETURN QUERY SELECT v_price_list_price, 'price_list'::text;
        END IF;
    ELSE
        IF p_quantity >= 10 AND v_default_bulk_price IS NOT NULL THEN
            RETURN QUERY SELECT v_default_bulk_price, 'default_bulk'::text;
        ELSE
            RETURN QUERY SELECT v_default_price, 'default'::text;
        END IF;
    END IF;
END;
$$;
```

**8. Grant permissions**:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON dw.customer_price_list TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON dw.customer_price_override TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE dw.customer_price_list_price_list_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE dw.customer_price_override_override_id_seq TO authenticated;
GRANT SELECT ON dw.vw_customer_product_price TO authenticated;
```

### Commands and Verification

Run the migration:
```bash
cd /Users/damiengreen/Desktop/Data\ Warehouse
supabase db push
```

Verify tables exist:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'dw' AND table_name LIKE 'customer_price%';
-- Expected: customer_price_list, customer_price_override
```

Verify the view works:
```sql
SELECT COUNT(*) FROM dw.vw_customer_product_price LIMIT 1;
-- Should return a number (count of customer x product combinations)
```

Verify the RPC function is accessible:
```sql
SELECT * FROM public.get_customer_price_list('some-customer-id');
-- Should return empty result (no price lists yet)
```

### Completion Criteria

- Both tables exist with correct constraints and indexes
- The `has_custom_price_list` column exists on `dim_customer`
- The trigger keeps the flag in sync
- The view `vw_customer_product_price` returns data
- The functions `get_customer_price_list` and `get_customer_price` execute without error
- All grants are applied

Upon completion: Update Progress section to mark Milestone 1 complete, commit with message "Add customer price list schema".

---

## Milestone 2: Backend API Endpoints

### Goal

Create FastAPI endpoints for managing customer price lists and generating customer-specific PDF price lists. At the end of this milestone, the API can create, read, update, and delete price lists, and generate branded PDFs for specific customers.

### Prerequisites

- Milestone 1 complete (database schema exists)
- Verify tables exist by running: `SELECT * FROM dw.customer_price_list LIMIT 1;`

### Context for This Milestone

The FastAPI application is at `/api/main.py`. It uses psycopg for database connections and already has a price list PDF endpoint at `/api/price-list/pdf`. The PDF generator is at `/scripts/generate_price_list_pdf.py`.

We need to add:
1. Pydantic models for request/response
2. CRUD endpoints for price lists under `/api/customers/{customer_id}/price-list`
3. Modify the PDF generator to support customer-specific lists
4. Add a customer-specific PDF endpoint

### Work

**1. Add Pydantic models to `/api/main.py`** (after existing model definitions, around line 50):

```python
class PriceOverrideInput(BaseModel):
    product_id: int
    custom_price: float
    custom_bulk_price: float | None = None

class CreatePriceListRequest(BaseModel):
    name: str = "Custom Prices"
    description: str | None = None
    overrides: list[PriceOverrideInput] = []

class UpdatePriceListRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    overrides: list[PriceOverrideInput] | None = None

class PriceOverrideResponse(BaseModel):
    override_id: int
    product_id: int
    product_code: str
    item_name: str
    default_price: float | None
    custom_price: float
    custom_bulk_price: float | None

class PriceListResponse(BaseModel):
    price_list_id: int
    customer_id: str
    customer_name: str
    name: str
    description: str | None
    effective_from: str
    is_active: bool
    override_count: int
    overrides: list[PriceOverrideResponse] = []
```

**2. Add GET endpoint to retrieve customer's price list** (add after line 274):

```python
@app.get("/api/customers/{customer_id}/price-list")
async def get_customer_price_list(customer_id: str):
    """Get the active price list for a customer with all overrides."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Get customer info and price list header
            cur.execute("""
                SELECT c.customer_id, c.customer_name,
                       cpl.price_list_id, cpl.name, cpl.description,
                       cpl.effective_from, cpl.is_active
                FROM dw.dim_customer c
                LEFT JOIN dw.customer_price_list cpl
                    ON cpl.customer_id = c.customer_id
                    AND cpl.is_active = true
                    AND cpl.effective_to IS NULL
                WHERE c.customer_id = %s
            """, (customer_id,))
            row = cur.fetchone()

            if not row:
                raise HTTPException(status_code=404, detail="Customer not found")

            customer_id, customer_name, price_list_id, name, description, effective_from, is_active = row

            if price_list_id is None:
                return {"customer_id": customer_id, "customer_name": customer_name, "price_list": None}

            # Get overrides
            cur.execute("""
                SELECT cpo.override_id, cpo.product_id, p.product_code, p.item_name,
                       p.price as default_price, cpo.custom_price, cpo.custom_bulk_price
                FROM dw.customer_price_override cpo
                JOIN dw.dim_product p ON p.product_id = cpo.product_id
                WHERE cpo.price_list_id = %s
                ORDER BY p.item_name
            """, (price_list_id,))

            overrides = [
                {
                    "override_id": r[0], "product_id": r[1], "product_code": r[2],
                    "item_name": r[3], "default_price": float(r[4]) if r[4] else None,
                    "custom_price": float(r[5]), "custom_bulk_price": float(r[6]) if r[6] else None
                }
                for r in cur.fetchall()
            ]

            return {
                "customer_id": customer_id,
                "customer_name": customer_name,
                "price_list": {
                    "price_list_id": price_list_id,
                    "name": name,
                    "description": description,
                    "effective_from": effective_from.isoformat() if effective_from else None,
                    "is_active": is_active,
                    "override_count": len(overrides),
                    "overrides": overrides
                }
            }
```

**3. Add POST endpoint to create price list**:

```python
@app.post("/api/customers/{customer_id}/price-list")
async def create_customer_price_list(customer_id: str, request: CreatePriceListRequest):
    """Create a new price list for a customer. Deactivates any existing active list."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify customer exists
            cur.execute("SELECT customer_id FROM dw.dim_customer WHERE customer_id = %s", (customer_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Customer not found")

            # Deactivate existing active price lists
            cur.execute("""
                UPDATE dw.customer_price_list
                SET is_active = false, effective_to = CURRENT_DATE
                WHERE customer_id = %s AND is_active = true
            """, (customer_id,))

            # Create new price list
            cur.execute("""
                INSERT INTO dw.customer_price_list (customer_id, name, description)
                VALUES (%s, %s, %s)
                RETURNING price_list_id
            """, (customer_id, request.name, request.description))
            price_list_id = cur.fetchone()[0]

            # Insert overrides
            if request.overrides:
                for override in request.overrides:
                    cur.execute("""
                        INSERT INTO dw.customer_price_override
                            (price_list_id, product_id, custom_price, custom_bulk_price)
                        VALUES (%s, %s, %s, %s)
                    """, (price_list_id, override.product_id, override.custom_price, override.custom_bulk_price))

            conn.commit()
            return {"price_list_id": price_list_id, "message": "Price list created"}
```

**4. Add PUT endpoint to update price list**:

```python
@app.put("/api/customers/{customer_id}/price-list/{price_list_id}")
async def update_customer_price_list(customer_id: str, price_list_id: int, request: UpdatePriceListRequest):
    """Update an existing price list."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify price list exists and belongs to customer
            cur.execute("""
                SELECT price_list_id FROM dw.customer_price_list
                WHERE price_list_id = %s AND customer_id = %s AND is_active = true
            """, (price_list_id, customer_id))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Price list not found")

            # Update header fields if provided
            if request.name is not None or request.description is not None:
                updates = []
                params = []
                if request.name is not None:
                    updates.append("name = %s")
                    params.append(request.name)
                if request.description is not None:
                    updates.append("description = %s")
                    params.append(request.description)
                updates.append("updated_at = timezone('utc', now())")
                params.append(price_list_id)

                cur.execute(f"""
                    UPDATE dw.customer_price_list
                    SET {', '.join(updates)}
                    WHERE price_list_id = %s
                """, params)

            # Replace overrides if provided
            if request.overrides is not None:
                cur.execute("DELETE FROM dw.customer_price_override WHERE price_list_id = %s", (price_list_id,))
                for override in request.overrides:
                    cur.execute("""
                        INSERT INTO dw.customer_price_override
                            (price_list_id, product_id, custom_price, custom_bulk_price)
                        VALUES (%s, %s, %s, %s)
                    """, (price_list_id, override.product_id, override.custom_price, override.custom_bulk_price))

            conn.commit()
            return {"message": "Price list updated"}
```

**5. Add DELETE endpoint**:

```python
@app.delete("/api/customers/{customer_id}/price-list/{price_list_id}")
async def delete_customer_price_list(customer_id: str, price_list_id: int):
    """Soft delete (deactivate) a price list."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE dw.customer_price_list
                SET is_active = false, effective_to = CURRENT_DATE, updated_at = timezone('utc', now())
                WHERE price_list_id = %s AND customer_id = %s AND is_active = true
                RETURNING price_list_id
            """, (price_list_id, customer_id))

            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Price list not found")

            conn.commit()
            return {"message": "Price list deleted"}
```

**6. Add customer-specific PDF endpoint**:

```python
@app.get("/api/customers/{customer_id}/price-list/pdf")
async def get_customer_price_list_pdf(customer_id: str, include_all: bool = False):
    """Generate PDF price list for a specific customer."""
    from scripts.generate_price_list_pdf import generate_customer_price_list_pdf, fetch_customer_products

    with get_db_connection() as conn:
        customer_info, products = fetch_customer_products(conn, customer_id, include_all)

        if not customer_info:
            raise HTTPException(status_code=404, detail="Customer not found")

        pdf_bytes = generate_customer_price_list_pdf(customer_info, products)

        safe_name = customer_info['customer_name'].replace(' ', '_').replace('/', '-')
        filename = f"Price_List_{safe_name}_{datetime.now().strftime('%Y%m%d')}.pdf"

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
```

**7. Modify `/scripts/generate_price_list_pdf.py`** - Add these functions after the existing `fetch_products` function:

```python
def fetch_customer_products(conn, customer_id: str, include_all: bool = False) -> tuple[dict | None, list[dict]]:
    """
    Fetch products with effective prices for a customer.

    Args:
        conn: Database connection
        customer_id: The customer ID
        include_all: If True, include all products. If False, only products with custom prices.

    Returns:
        tuple of (customer_info dict, products list)
    """
    with conn.cursor() as cur:
        # Get customer info
        cur.execute("""
            SELECT customer_id, customer_name, merchant_group
            FROM dw.dim_customer
            WHERE customer_id = %s
        """, (customer_id,))
        row = cur.fetchone()
        if not row:
            return None, []

        customer_info = {
            "customer_id": row[0],
            "customer_name": row[1],
            "merchant_group": row[2]
        }

        # Get products with effective prices
        if include_all:
            cur.execute("""
                SELECT p.item_name,
                       COALESCE(cpo.custom_price, p.price_list_price, p.price) as effective_price,
                       COALESCE(cpo.custom_bulk_price, p.bulk_price) as effective_bulk_price,
                       CASE WHEN cpo.override_id IS NOT NULL THEN true ELSE false END as has_override
                FROM dw.dim_product p
                LEFT JOIN dw.customer_price_list cpl
                    ON cpl.customer_id = %s AND cpl.is_active = true AND cpl.effective_to IS NULL
                LEFT JOIN dw.customer_price_override cpo
                    ON cpo.price_list_id = cpl.price_list_id AND cpo.product_id = p.product_id
                WHERE p.archived = false AND p.is_tracked_as_inventory = true
                ORDER BY p.item_name
            """, (customer_id,))
        else:
            cur.execute("""
                SELECT p.item_name, cpo.custom_price, cpo.custom_bulk_price, true as has_override
                FROM dw.customer_price_list cpl
                JOIN dw.customer_price_override cpo ON cpo.price_list_id = cpl.price_list_id
                JOIN dw.dim_product p ON p.product_id = cpo.product_id
                WHERE cpl.customer_id = %s AND cpl.is_active = true AND cpl.effective_to IS NULL
                ORDER BY p.item_name
            """, (customer_id,))

        products = [
            {
                "item_name": row[0],
                "price": row[1],
                "bulk_price": row[2],
                "has_override": row[3]
            }
            for row in cur.fetchall()
        ]

        return customer_info, products


def generate_customer_price_list_pdf(customer_info: dict, products: list[dict]) -> bytes:
    """Generate PDF price list for a specific customer."""
    pdf = PriceListPDF()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # Add customer name below header
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(0, 8, f"Customer: {customer_info['customer_name']}", ln=True, align="L")
    if customer_info.get('merchant_group'):
        pdf.set_font("Helvetica", "", 10)
        pdf.cell(0, 5, f"Merchant Group: {customer_info['merchant_group']}", ln=True, align="L")
    pdf.ln(5)

    # Date
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(192, 14, 45)  # Red
    today = datetime.now().strftime("%d %B %Y")
    pdf.cell(0, 8, f"Pricing Effective {today}", ln=True, align="L")
    pdf.ln(3)

    # Table header
    pdf.set_fill_color(240, 240, 240)
    pdf.set_text_color(0, 0, 0)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(100, 8, "Product", border=1, fill=True)
    pdf.cell(40, 8, "Unit Price", border=1, align="C", fill=True)
    pdf.cell(40, 8, "Bulk Price", border=1, align="C", fill=True)
    pdf.ln()

    # Table rows
    pdf.set_font("Helvetica", "", 10)
    for product in products:
        if pdf.get_y() > 260:
            pdf.add_page()
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(100, 8, "Product", border=1, fill=True)
            pdf.cell(40, 8, "Unit Price", border=1, align="C", fill=True)
            pdf.cell(40, 8, "Bulk Price", border=1, align="C", fill=True)
            pdf.ln()
            pdf.set_font("Helvetica", "", 10)

        name = product["item_name"][:50] if len(product["item_name"]) > 50 else product["item_name"]
        price = format_currency(product["price"]) if product["price"] else "-"
        bulk = format_currency(product["bulk_price"]) if product["bulk_price"] else "-"

        pdf.cell(100, 7, name, border=1)
        pdf.cell(40, 7, price, border=1, align="C")
        pdf.cell(40, 7, bulk, border=1, align="C")
        pdf.ln()

    return bytes(pdf.output())
```

### Commands and Verification

Start the API server:
```bash
cd /Users/damiengreen/Desktop/Data\ Warehouse
uvicorn api.main:app --reload --port 8001
```

Test GET endpoint (should return customer with no price list):
```bash
curl http://localhost:8001/api/customers/CUST001/price-list
```

Test POST endpoint (create a price list):
```bash
curl -X POST http://localhost:8001/api/customers/CUST001/price-list \
  -H "Content-Type: application/json" \
  -d '{"name": "Export Prices", "overrides": [{"product_id": 1, "custom_price": 10.50}]}'
```

Test GET again (should now show price list with override):
```bash
curl http://localhost:8001/api/customers/CUST001/price-list
```

Test PDF generation:
```bash
curl -o test_pricelist.pdf http://localhost:8001/api/customers/CUST001/price-list/pdf
open test_pricelist.pdf
```

### Completion Criteria

- All 5 endpoints respond correctly (GET, POST, PUT, DELETE, PDF)
- Price list creation deactivates previous active list
- PDF generation includes customer name in header
- Overrides are stored and retrieved correctly

Upon completion: Update Progress section, commit with message "Add customer price list API endpoints".

---

## Milestone 3: Frontend Customer List Enhancements

### Goal

Add price list indicators and action buttons to the Customers page. At the end of this milestone, users can see which customers have custom price lists and access buttons to manage prices and print PDFs.

### Prerequisites

- Milestone 2 complete (API endpoints working)
- Verify by running: `curl http://localhost:8001/api/customers/CUST001/price-list`

### Context for This Milestone

The Customers page is at `/frontend/src/pages/Customers.tsx`. It displays a table of customers with columns for name, merchant group, market, cluster, customer type, and actions. The Customer interface needs to be extended to include price list status.

The page fetches customers using Supabase client with `.schema('dw')`. We need to update the query to include the `has_custom_price_list` field added in Milestone 1.

### Work

**1. Update Customer interface** in `Customers.tsx` (around line 20):

Add to the existing Customer interface:
```typescript
has_custom_price_list: boolean;
```

**2. Update the customer fetch query** (around line 80):

Find the existing select statement and add `has_custom_price_list`:
```typescript
.select(`
    customer_id,
    customer_name,
    contact_name,
    bill_to,
    merchant_group,
    market,
    customer_type,
    balance_total,
    archived,
    master_customer_id,
    has_custom_price_list,
    dim_customer_cluster!left(
        dim_cluster!inner(cluster_id, cluster_label)
    )
`)
```

**3. Add price list indicator badge** - Create a new component or inline in the table cell (around line 350):

Add a new column after "Customer Type" and before "Actions":
```tsx
<TableHead className="w-24">Price List</TableHead>
```

Add the cell content in the table row (around line 400):
```tsx
<TableCell>
    {customer.has_custom_price_list ? (
        <Badge variant="secondary" className="bg-green-100 text-green-800">
            Custom
        </Badge>
    ) : (
        <span className="text-muted-foreground text-sm">Default</span>
    )}
</TableCell>
```

**4. Add action buttons** - Update the Actions column (around line 420):

Replace the single edit button with a dropdown menu:
```tsx
<TableCell>
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => handleEditCustomer(customer)}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Details
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate(`/customers/${customer.customer_id}/prices`)}>
                <DollarSign className="h-4 w-4 mr-2" />
                Manage Prices
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handlePrintPriceList(customer.customer_id, customer.customer_name)}>
                <Printer className="h-4 w-4 mr-2" />
                Print Price List
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
</TableCell>
```

**5. Add required imports** at the top of the file:
```typescript
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Pencil, DollarSign, Printer } from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
```

**6. Add navigate hook and print handler** (around line 50):
```typescript
const navigate = useNavigate();

const handlePrintPriceList = async (customerId: string, customerName: string) => {
    try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
        const response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list/pdf?include_all=true`);

        if (!response.ok) throw new Error('Failed to generate PDF');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Price_List_${customerName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Failed to print price list:', error);
        alert('Failed to generate price list. Please try again.');
    }
};
```

### Commands and Verification

Start the frontend:
```bash
cd /Users/damiengreen/Desktop/Data\ Warehouse/frontend
npm run dev
```

Navigate to http://localhost:5173/customers (or the appropriate port).

Verify:
1. The "Price List" column appears showing "Default" for all customers
2. The action dropdown appears with three options: Edit Details, Manage Prices, Print Price List
3. Clicking "Manage Prices" navigates to `/customers/{id}/prices` (will show 404 until Milestone 4)
4. Clicking "Print Price List" downloads a PDF

### Completion Criteria

- Price List column displays correctly with "Custom" badge or "Default" text
- Action dropdown menu works with all three options
- Print Price List downloads a PDF successfully
- Manage Prices navigates to the correct URL

Upon completion: Update Progress section, commit with message "Add price list indicators and actions to customer list".

---

## Milestone 4: Frontend Price List Editor Page

### Goal

Create a dedicated page for managing customer price lists with a product search, editable price table, and save functionality. At the end of this milestone, users can create, edit, and save customer-specific price lists.

### Prerequisites

- Milestone 3 complete (customer list shows price list column and actions)
- Navigate to a customer and click "Manage Prices" - should show 404 (route not defined yet)

### Context for This Milestone

The frontend uses React Router for navigation (defined in `/frontend/src/App.tsx`). Pages are in `/frontend/src/pages/`. The UI uses shadcn/ui components from `/frontend/src/components/ui/`.

We need to:
1. Add a new route for `/customers/:customerId/prices`
2. Create a new page component `CustomerPriceList.tsx`
3. Implement product search, price editing, and save functionality

### Work

**1. Add route to App.tsx** (find the Routes section):

```tsx
import CustomerPriceList from './pages/CustomerPriceList';

// Inside <Routes>:
<Route path="/customers/:customerId/prices" element={<CustomerPriceList />} />
```

**2. Create new page** at `/frontend/src/pages/CustomerPriceList.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { ArrowLeft, Plus, Trash2, Printer, Save, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface Product {
    product_id: number;
    product_code: string;
    item_name: string;
    price: number | null;
    bulk_price: number | null;
}

interface PriceOverride {
    override_id?: number;
    product_id: number;
    product_code: string;
    item_name: string;
    default_price: number | null;
    default_bulk_price: number | null;
    custom_price: string;
    custom_bulk_price: string;
    isNew?: boolean;
}

interface PriceList {
    price_list_id: number;
    name: string;
    description: string | null;
    effective_from: string;
    override_count: number;
}

interface CustomerInfo {
    customer_id: string;
    customer_name: string;
}

export default function CustomerPriceList() {
    const { customerId } = useParams<{ customerId: string }>();
    const navigate = useNavigate();

    const [customer, setCustomer] = useState<CustomerInfo | null>(null);
    const [priceList, setPriceList] = useState<PriceList | null>(null);
    const [overrides, setOverrides] = useState<PriceOverride[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [hasChanges, setHasChanges] = useState(false);

    // Fetch customer data and price list
    useEffect(() => {
        async function loadData() {
            if (!customerId) return;
            setIsLoading(true);

            try {
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
                const response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list`);

                if (!response.ok) throw new Error('Failed to load price list');

                const data = await response.json();
                setCustomer({ customer_id: data.customer_id, customer_name: data.customer_name });

                if (data.price_list) {
                    setPriceList(data.price_list);
                    setOverrides(data.price_list.overrides.map((o: any) => ({
                        ...o,
                        custom_price: o.custom_price?.toString() || '',
                        custom_bulk_price: o.custom_bulk_price?.toString() || '',
                    })));
                }

                // Load all products for search
                const { data: productsData } = await supabase
                    .schema('dw')
                    .from('dim_product')
                    .select('product_id, product_code, item_name, price, bulk_price')
                    .eq('archived', false)
                    .eq('is_tracked_as_inventory', true)
                    .order('item_name');

                setProducts(productsData || []);
            } catch (error) {
                console.error('Error loading data:', error);
                alert('Failed to load customer data');
            } finally {
                setIsLoading(false);
            }
        }

        loadData();
    }, [customerId]);

    // Filter products not already in overrides
    const availableProducts = useMemo(() => {
        const overrideIds = new Set(overrides.map(o => o.product_id));
        return products.filter(p => !overrideIds.has(p.product_id));
    }, [products, overrides]);

    const filteredProducts = useMemo(() => {
        if (!searchValue) return availableProducts.slice(0, 50);
        const lower = searchValue.toLowerCase();
        return availableProducts
            .filter(p => p.item_name.toLowerCase().includes(lower) || p.product_code.toLowerCase().includes(lower))
            .slice(0, 50);
    }, [availableProducts, searchValue]);

    const handleAddProduct = (product: Product) => {
        const newOverride: PriceOverride = {
            product_id: product.product_id,
            product_code: product.product_code,
            item_name: product.item_name,
            default_price: product.price,
            default_bulk_price: product.bulk_price,
            custom_price: product.price?.toString() || '',
            custom_bulk_price: product.bulk_price?.toString() || '',
            isNew: true,
        };
        setOverrides([...overrides, newOverride]);
        setSearchOpen(false);
        setSearchValue('');
        setHasChanges(true);
    };

    const handleRemoveOverride = (productId: number) => {
        setOverrides(overrides.filter(o => o.product_id !== productId));
        setHasChanges(true);
    };

    const handlePriceChange = (productId: number, field: 'custom_price' | 'custom_bulk_price', value: string) => {
        setOverrides(overrides.map(o =>
            o.product_id === productId ? { ...o, [field]: value } : o
        ));
        setHasChanges(true);
    };

    const handleSave = async () => {
        if (!customerId) return;
        setIsSaving(true);

        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
            const payload = {
                name: priceList?.name || 'Custom Prices',
                overrides: overrides.map(o => ({
                    product_id: o.product_id,
                    custom_price: parseFloat(o.custom_price) || 0,
                    custom_bulk_price: o.custom_bulk_price ? parseFloat(o.custom_bulk_price) : null,
                })),
            };

            let response;
            if (priceList) {
                response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list/${priceList.price_list_id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            } else {
                response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
            }

            if (!response.ok) throw new Error('Failed to save');

            const result = await response.json();
            if (result.price_list_id) {
                setPriceList({ ...priceList, price_list_id: result.price_list_id } as PriceList);
            }

            setHasChanges(false);
            setOverrides(overrides.map(o => ({ ...o, isNew: false })));
        } catch (error) {
            console.error('Save failed:', error);
            alert('Failed to save price list');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePrint = async () => {
        if (!customerId || !customer) return;

        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
            const response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list/pdf`);

            if (!response.ok) throw new Error('Failed to generate PDF');

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Price_List_${customer.customer_name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Print failed:', error);
            alert('Failed to generate PDF');
        }
    };

    const formatCurrency = (value: number | null) => {
        if (value === null || value === undefined) return '-';
        return `$${value.toFixed(2)}`;
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="container mx-auto py-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" onClick={() => navigate('/customers')}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold">{customer?.customer_name}</h1>
                        <p className="text-muted-foreground">
                            {priceList ? `Price List: ${priceList.name}` : 'No custom price list'}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handlePrint} disabled={overrides.length === 0}>
                        <Printer className="h-4 w-4 mr-2" />
                        Print PDF
                    </Button>
                    <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
                        {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        Save Changes
                    </Button>
                </div>
            </div>

            {/* Product Search */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Add Products</CardTitle>
                </CardHeader>
                <CardContent>
                    <Popover open={searchOpen} onOpenChange={setSearchOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="outline" className="w-full justify-start">
                                <Plus className="h-4 w-4 mr-2" />
                                Search and add products...
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[500px] p-0" align="start">
                            <Command>
                                <CommandInput
                                    placeholder="Search products..."
                                    value={searchValue}
                                    onValueChange={setSearchValue}
                                />
                                <CommandList>
                                    <CommandEmpty>No products found.</CommandEmpty>
                                    <CommandGroup>
                                        {filteredProducts.map(product => (
                                            <CommandItem
                                                key={product.product_id}
                                                onSelect={() => handleAddProduct(product)}
                                            >
                                                <div className="flex justify-between w-full">
                                                    <div>
                                                        <span className="font-medium">{product.item_name}</span>
                                                        <Badge variant="outline" className="ml-2 text-xs">
                                                            {product.product_code}
                                                        </Badge>
                                                    </div>
                                                    <span className="text-muted-foreground">
                                                        {formatCurrency(product.price)}
                                                    </span>
                                                </div>
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </CardContent>
            </Card>

            {/* Price Overrides Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">
                        Custom Prices
                        {overrides.length > 0 && (
                            <Badge variant="secondary" className="ml-2">{overrides.length} products</Badge>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {overrides.length === 0 ? (
                        <p className="text-muted-foreground text-center py-8">
                            No custom prices set. Add products above to create custom pricing.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[300px]">Product</TableHead>
                                    <TableHead className="w-[120px]">Default Price</TableHead>
                                    <TableHead className="w-[150px]">Custom Price</TableHead>
                                    <TableHead className="w-[150px]">Custom Bulk</TableHead>
                                    <TableHead className="w-[60px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overrides.map(override => (
                                    <TableRow key={override.product_id}>
                                        <TableCell>
                                            <div>
                                                <span className="font-medium">{override.item_name}</span>
                                                <Badge variant="outline" className="ml-2 text-xs">
                                                    {override.product_code}
                                                </Badge>
                                                {override.isNew && (
                                                    <Badge className="ml-2 text-xs bg-blue-100 text-blue-800">New</Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {formatCurrency(override.default_price)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center">
                                                <span className="mr-1">$</span>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={override.custom_price}
                                                    onChange={(e) => handlePriceChange(override.product_id, 'custom_price', e.target.value)}
                                                    className="w-24"
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center">
                                                <span className="mr-1">$</span>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={override.custom_bulk_price}
                                                    onChange={(e) => handlePriceChange(override.product_id, 'custom_bulk_price', e.target.value)}
                                                    className="w-24"
                                                    placeholder="Optional"
                                                />
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => handleRemoveOverride(override.product_id)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
```

### Commands and Verification

Start frontend and backend:
```bash
# Terminal 1
cd /Users/damiengreen/Desktop/Data\ Warehouse
uvicorn api.main:app --reload --port 8001

# Terminal 2
cd /Users/damiengreen/Desktop/Data\ Warehouse/frontend
npm run dev
```

Navigate to http://localhost:5173/customers, click the action menu on any customer, and select "Manage Prices".

Verify:
1. Page loads with customer name and "No custom price list" message
2. Product search combobox works and shows available products
3. Adding a product shows it in the table with editable prices
4. Save button is disabled until changes are made
5. After save, the price list is persisted (reload page to confirm)
6. Print PDF downloads a PDF with customer name

### Completion Criteria

- Route `/customers/:customerId/prices` renders the price list editor
- Product search filters and adds products correctly
- Price inputs are editable and changes are tracked
- Save persists to database and shows success
- Print generates customer-specific PDF
- Navigation back to customers list works

Upon completion: Update Progress section, commit with message "Add customer price list editor page".

---

## Interfaces and Dependencies

**New Database Objects** (dw schema):
- `dw.customer_price_list` - Price list header table
- `dw.customer_price_override` - Price override line items
- `dw.vw_customer_product_price` - View for effective price lookup
- `dw.get_customer_price()` - Function for invoice pricing lookup
- `dw.update_customer_price_list_flag()` - Trigger function

**New API Endpoints**:
- `GET /api/customers/{customer_id}/price-list` - Get price list with overrides
- `POST /api/customers/{customer_id}/price-list` - Create price list
- `PUT /api/customers/{customer_id}/price-list/{price_list_id}` - Update price list
- `DELETE /api/customers/{customer_id}/price-list/{price_list_id}` - Delete price list
- `GET /api/customers/{customer_id}/price-list/pdf` - Generate customer PDF

**New Frontend Components**:
- `CustomerPriceList.tsx` - Price list editor page

**Modified Files**:
- `/api/main.py` - Add endpoints and Pydantic models
- `/scripts/generate_price_list_pdf.py` - Add customer-specific functions
- `/frontend/src/App.tsx` - Add route
- `/frontend/src/pages/Customers.tsx` - Add price list column and actions

**Libraries Used** (all existing in project):
- FastAPI, psycopg (backend)
- React, react-router-dom, shadcn/ui (frontend)
- FPDF (PDF generation)

## Idempotence and Recovery

**Database Migration**: Can be run multiple times safely using `IF NOT EXISTS` clauses. If tables exist, migration is skipped.

**API Endpoints**: All operations are idempotent:
- GET: Safe, no side effects
- POST: Creates new list, deactivates old (can be repeated)
- PUT: Full replacement of overrides (can be repeated with same data)
- DELETE: Soft delete (can be repeated)

**Frontend**: State is loaded from API on mount, ensuring consistency with database.

**Recovery**:
- If migration fails: Fix issue and re-run, existing data preserved
- If API save fails: Frontend shows error, user can retry
- If frontend crashes: Reload page, unsaved changes lost but database state intact

## Artifacts and Notes

**Sample API Responses**:

GET /api/customers/CUST001/price-list (no price list):
```json
{
    "customer_id": "CUST001",
    "customer_name": "ABC Exports Ltd",
    "price_list": null
}
```

GET /api/customers/CUST001/price-list (with price list):
```json
{
    "customer_id": "CUST001",
    "customer_name": "ABC Exports Ltd",
    "price_list": {
        "price_list_id": 1,
        "name": "Export Prices",
        "description": null,
        "effective_from": "2026-01-20",
        "is_active": true,
        "override_count": 3,
        "overrides": [
            {
                "override_id": 1,
                "product_id": 42,
                "product_code": "KLP001",
                "item_name": "Klipon Widget 1kg",
                "default_price": 12.50,
                "custom_price": 10.00,
                "custom_bulk_price": 9.50
            }
        ]
    }
}
```

**PDF Output**: Customer name appears below the Akina Trading header, followed by effective date and price table.
