# WIP "Unpacked" Products and Stock Cover Planning

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with PLANS.md at docs/Plans.md.

## Purpose / Big Picture

This change enables comprehensive stock cover planning by tracking work-in-progress (WIP) inventory at suppliers. Currently, the system only tracks finished goods. Suppliers often produce in bulk and store WIP in large fadges ready to be packed when required. This unpacked WIP represents manufacturing capacity that should factor into stock cover calculations.

After implementation, users will be able to:

1. See one "XXX Unpacked" product per product cluster representing WIP inventory at suppliers
2. Have suppliers report their WIP stock levels alongside finished goods
3. Enter production capacity per day for WIP products (how many base units can be packed daily)
4. View comprehensive stock cover that includes: our stock + supplier finished stock + supplier WIP + production capacity
5. Receive alerts when upcoming demand exceeds total available supply plus production capacity

Observable behavior: Navigate to Cluster Analytics and see a new "Total Stock Cover" metric that sums our inventory, all supplier inventory (finished + WIP), and factors in production capacity. WIP products will NOT appear in price lists, sales reports, or general product listings.

## Progress

- [x] Milestone 1: Database schema changes for WIP products
- [x] Milestone 2: Auto-create "XXX Unpacked" products for each product cluster
- [x] Milestone 3: Update supplier portal to include WIP products
- [x] Milestone 4: Update report queries to exclude WIP products
- [x] Milestone 5: Comprehensive stock aggregation UI

Note: Demand-based calculations and alerting are out of scope for this implementation. Production capacity is stored for future demand planning features.

## Surprises & Discoveries

**2026-01-21 - CRITICAL BUG: Customer Merge Logic Accidentally Removed**
- **Issue**: The `mart.sales_enriched` view recreation in Milestone 4 accidentally removed the customer merge logic clause `OR c.master_customer_id IS NOT NULL`
- **Impact**: All sales from archived/merged customers were excluded from reports, causing significant data loss in dashboard (especially January sales)
- **Root Cause**: When adding WIP exclusion filters, the original customer filtering logic was simplified incorrectly
- **Original (correct)**: `AND (c.archived IS DISTINCT FROM true OR c.master_customer_id IS NOT NULL)`
- **Broken**: `AND (c.archived IS DISTINCT FROM true)`
- **Fix**: Restored the `OR c.master_customer_id IS NOT NULL` clause
- **Hotfix file**: `supabase/migrations/HOTFIX_20260121_fix_sales_view.sql`

## Decision Log

**2026-01-20 - Product Type Approach**
- Decision: Use a new `product_type` column on `dim_product` with values 'finished' (default) and 'wip'
- Rationale: More extensible than a boolean flag; allows future product types. Existing products remain 'finished' by default.
- Alternatives considered: `is_wip` boolean (simpler but less extensible), separate WIP table (more complex, harder to integrate)

**2026-01-20 - WIP-Cluster Relationship**
- Decision: Add `wip_for_cluster_id` foreign key on `dim_product` to link WIP products to their parent cluster
- Rationale: Each WIP product represents unpacked inventory for exactly one cluster. This is distinct from the `dim_product_cluster` table which tracks which finished products belong to a cluster with their unit multipliers.

**2026-01-20 - Production Capacity Storage**
- Decision: Add `production_capacity_per_day` column to `dim_product`, applicable only to WIP products
- Rationale: Capacity is per-WIP-product and measured in base units (same as cluster's `base_unit_label`). This allows different capacity at different suppliers if needed.

**2026-01-20 - Supplier Stock Entry Scope**
- Decision: Suppliers enter WIP stock in the same portal, WIP products grouped separately
- Rationale: Simplest UX - one place for suppliers to report all stock. WIP products appear in their own section labeled "Work in Progress".

**2026-01-20 - Demand Calculations Out of Scope**
- Decision: Demand-based calculations (days of cover, alerting) are out of scope for this implementation
- Rationale: User clarified that demand is out of scope. Production capacity field is stored for future demand planning features.
- Impact: Milestone 5 simplified to show stock totals without demand projections. Milestone 6 (alerting) removed.

## Outcomes & Retrospective

**2026-01-20 - Milestone 5 Complete**
- Created `get_cluster_stock_totals()` RPC in `20260121_stock_aggregation.sql`
- Updated ClusterAnalytics.tsx with comprehensive stock position UI showing:
  - Our Stock (from dim_product.quantity_on_hand)
  - Supplier Finished Stock (from supplier_stock_entry for finished products)
  - Supplier WIP Stock (from supplier_stock_entry for WIP products)
  - Total Available (sum of all sources)
  - Production Capacity/Day (from WIP products)
- Added visual stock breakdown bar chart showing proportions
- All milestones complete - WIP product feature is fully implemented

## Context and Orientation

This section describes the current state of the codebase relevant to this task.

### Product and Cluster Data Model

Products are stored in `dw.dim_product` with key columns:
- `product_id` (bigint, PK) - unique identifier
- `product_code` (text) - SKU code
- `item_name` (text) - display name
- `is_tracked_as_inventory` (boolean) - whether to track stock
- `archived` (boolean) - soft delete flag
- `quantity_on_hand` (integer) - our current stock level

Product clusters are stored in `dw.dim_cluster` with:
- `cluster_id` (integer, PK) - unique identifier
- `cluster_label` (text) - display name (e.g., "KiwiKlips", "Grapples")
- `cluster_type` (text) - 'customer' or 'product'
- `base_unit_label` (text) - unit of measurement (e.g., "clips", "meters")

The junction table `dw.dim_product_cluster` links products to clusters:
- `product_id` (FK to dim_product)
- `cluster_id` (FK to dim_cluster)
- `unit_multiplier` (numeric) - how many base units per product unit

### Supplier Stock Model

Supplier stock entries are stored in `dw.supplier_stock_entry`:
- `user_id` (uuid, FK to auth.users) - the supplier user
- `product_id` (bigint, FK to dim_product) - the product
- `quantity_on_hand` (integer) - stock quantity
- `week_ending` (date) - Saturday of reporting week
- Unique constraint on (user_id, product_id, week_ending)

Row Level Security (RLS) ensures suppliers only see their own entries.

### Report Filtering

All reports currently filter products using:
- `archived = false` - excludes soft-deleted products
- `is_tracked_as_inventory = true` - only inventory-tracked items

Key report locations:
- Sales reports: `src/reporting/sales_report.py` uses `mart.sales_enriched` view
- Price lists: `scripts/generate_price_list_pdf.py` queries `dw.dim_product` directly
- Customer price lists: `api/main.py` endpoints use same filters
- Products page: `frontend/src/pages/Products.tsx` applies filters in Supabase query

### Cluster Analytics

Current analytics in `frontend/src/pages/ClusterAnalytics.tsx` use these RPCs:
- `get_product_cluster_summary()` - aggregates stock and sales by cluster
- `get_cluster_product_details()` - shows products within a cluster
- `mart.cluster_units_summary` view - includes `estimated_days_of_stock`

These currently only consider `quantity_on_hand` from `dim_product` (our stock). They do not include supplier stock or WIP.

### Key Files

| Component | File Path |
|-----------|-----------|
| Product schema | `supabase/schema.sql` lines 77-88 |
| Cluster schema | `supabase/schema.sql` lines 64-71 |
| Product-cluster junction | `supabase/migrations/20251211_cluster_management.sql` |
| Cluster analytics RPCs | `supabase/migrations/20260119_cluster_analytics_rpcs.sql` |
| Supplier stock schema | `supabase/migrations/20260120_supplier_stock.sql` |
| Supplier portal UI | `frontend/src/pages/SupplierStock.tsx` |
| Cluster analytics UI | `frontend/src/pages/ClusterAnalytics.tsx` |
| Products page | `frontend/src/pages/Products.tsx` |
| Price list generator | `scripts/generate_price_list_pdf.py` |
| Sales report | `src/reporting/sales_report.py` |
| API endpoints | `api/main.py` |

---

## Milestone 1: Database Schema Changes for WIP Products

### Goal

Add database columns and constraints to support WIP products with production capacity tracking. At the end of this milestone, the database schema will support distinguishing WIP products from finished products, linking WIP products to their parent cluster, and storing production capacity.

### Prerequisites

- Database access to run migrations
- No pending migrations in queue
- Current schema includes `dw.dim_product` and `dw.dim_cluster` tables

### Context for This Milestone

The `dw.dim_product` table currently has these relevant columns: `product_id`, `product_code`, `item_name`, `is_tracked_as_inventory`, `archived`. We need to add:

1. `product_type` - distinguishes 'finished' from 'wip' products
2. `wip_for_cluster_id` - links WIP products to their parent product cluster
3. `production_capacity_per_day` - daily production capacity in base units

### Work

Create a new migration file `supabase/migrations/20260120_wip_products.sql` with these changes:

**Add product_type column:**
```sql
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS product_type text DEFAULT 'finished';

COMMENT ON COLUMN dw.dim_product.product_type IS
'Type of product: finished (default, sellable), wip (work-in-progress at supplier)';
```

**Add wip_for_cluster_id column:**
```sql
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS wip_for_cluster_id integer REFERENCES dw.dim_cluster(cluster_id);

COMMENT ON COLUMN dw.dim_product.wip_for_cluster_id IS
'For WIP products: the product cluster this WIP inventory represents unpacked stock for';

CREATE INDEX IF NOT EXISTS idx_dim_product_wip_cluster
ON dw.dim_product(wip_for_cluster_id) WHERE wip_for_cluster_id IS NOT NULL;
```

**Add production_capacity_per_day column:**
```sql
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS production_capacity_per_day numeric(18,2);

COMMENT ON COLUMN dw.dim_product.production_capacity_per_day IS
'For WIP products: max base units that can be packed/produced per day';
```

**Add check constraint:**
```sql
ALTER TABLE dw.dim_product
ADD CONSTRAINT chk_wip_product_has_cluster
CHECK (
    (product_type = 'wip' AND wip_for_cluster_id IS NOT NULL) OR
    (product_type != 'wip')
);
```

### Commands and Verification

Run the migration from project root:
```bash
cd /Users/damiengreen/Desktop/Data\ Warehouse
supabase db push
```

Verify columns exist:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'dw' AND table_name = 'dim_product'
AND column_name IN ('product_type', 'wip_for_cluster_id', 'production_capacity_per_day');
```

Expected output: 3 rows showing the new columns.

Verify constraint:
```sql
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_schema = 'dw' AND table_name = 'dim_product'
AND constraint_name = 'chk_wip_product_has_cluster';
```

### Completion Criteria

- All three columns exist on `dw.dim_product`
- Check constraint prevents WIP products without a cluster
- Index exists on `wip_for_cluster_id`
- Update Progress section, commit with message "Add WIP product schema columns"

---

## Milestone 2: Auto-Create "XXX Unpacked" Products for Each Product Cluster

### Goal

Create a database function that generates one "XXX Unpacked" WIP product for each product cluster. At the end of this milestone, calling the function will create WIP products for all clusters that don't already have one.

### Prerequisites

- Milestone 1 complete (product_type, wip_for_cluster_id columns exist)
- At least one product cluster exists in `dw.dim_cluster` with `cluster_type = 'product'`

### Context for This Milestone

Product clusters are in `dw.dim_cluster` with columns:
- `cluster_id` (integer PK)
- `cluster_label` (text) - e.g., "KiwiKlips"
- `cluster_type` (text) - must be 'product' for our clusters
- `base_unit_label` (text) - e.g., "clips"

WIP products need:
- `product_code` = cluster_label + '_UNPACKED' (e.g., "KIWIKILPS_UNPACKED")
- `item_name` = cluster_label + ' Unpacked' (e.g., "KiwiKlips Unpacked")
- `product_type` = 'wip'
- `wip_for_cluster_id` = cluster_id
- `is_tracked_as_inventory` = true
- `archived` = false

We need a unique product_id. The existing pattern uses large integers. We'll use a sequence or generate based on cluster_id (e.g., 9000000 + cluster_id).

### Work

Add to the same migration file `supabase/migrations/20260120_wip_products.sql`:

**Create function to generate WIP products:**
```sql
CREATE OR REPLACE FUNCTION public.create_wip_products_for_clusters()
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    wip_product_id bigint,
    wip_product_code text,
    created boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cluster RECORD;
    v_product_id bigint;
    v_product_code text;
    v_item_name text;
    v_created boolean;
BEGIN
    FOR v_cluster IN
        SELECT c.cluster_id, c.cluster_label
        FROM dw.dim_cluster c
        WHERE c.cluster_type = 'product'
        ORDER BY c.cluster_id
    LOOP
        -- Generate product code from cluster label (uppercase, replace spaces with underscores)
        v_product_code := UPPER(REGEXP_REPLACE(v_cluster.cluster_label, '\s+', '_', 'g')) || '_UNPACKED';
        v_item_name := v_cluster.cluster_label || ' Unpacked';

        -- Check if WIP product already exists for this cluster
        SELECT p.product_id INTO v_product_id
        FROM dw.dim_product p
        WHERE p.wip_for_cluster_id = v_cluster.cluster_id
          AND p.product_type = 'wip';

        IF v_product_id IS NULL THEN
            -- Generate a unique product_id (9000000 + cluster_id to avoid collisions)
            v_product_id := 9000000 + v_cluster.cluster_id;

            -- Check if this ID is already used, if so find next available
            WHILE EXISTS (SELECT 1 FROM dw.dim_product WHERE product_id = v_product_id) LOOP
                v_product_id := v_product_id + 1000;
            END LOOP;

            INSERT INTO dw.dim_product (
                product_id,
                product_code,
                item_name,
                product_type,
                wip_for_cluster_id,
                is_tracked_as_inventory,
                archived,
                created_at,
                updated_at
            ) VALUES (
                v_product_id,
                v_product_code,
                v_item_name,
                'wip',
                v_cluster.cluster_id,
                true,
                false,
                NOW(),
                NOW()
            );

            v_created := true;
        ELSE
            v_created := false;
        END IF;

        cluster_id := v_cluster.cluster_id;
        cluster_label := v_cluster.cluster_label;
        wip_product_id := v_product_id;
        wip_product_code := v_product_code;
        created := v_created;
        RETURN NEXT;
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_wip_products_for_clusters() TO authenticated;

COMMENT ON FUNCTION public.create_wip_products_for_clusters() IS
'Creates one WIP "Unpacked" product for each product cluster that does not already have one.
Returns list of all clusters with their WIP product info and whether it was newly created.';
```

**Create trigger to auto-create WIP product when new cluster is created:**
```sql
CREATE OR REPLACE FUNCTION dw.auto_create_wip_for_new_cluster()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_product_id bigint;
    v_product_code text;
    v_item_name text;
BEGIN
    -- Only for product clusters
    IF NEW.cluster_type = 'product' THEN
        v_product_code := UPPER(REGEXP_REPLACE(NEW.cluster_label, '\s+', '_', 'g')) || '_UNPACKED';
        v_item_name := NEW.cluster_label || ' Unpacked';
        v_product_id := 9000000 + NEW.cluster_id;

        -- Find unique ID
        WHILE EXISTS (SELECT 1 FROM dw.dim_product WHERE product_id = v_product_id) LOOP
            v_product_id := v_product_id + 1000;
        END LOOP;

        INSERT INTO dw.dim_product (
            product_id, product_code, item_name, product_type,
            wip_for_cluster_id, is_tracked_as_inventory, archived
        ) VALUES (
            v_product_id, v_product_code, v_item_name, 'wip',
            NEW.cluster_id, true, false
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_wip_product ON dw.dim_cluster;
CREATE TRIGGER trg_auto_create_wip_product
    AFTER INSERT ON dw.dim_cluster
    FOR EACH ROW
    EXECUTE FUNCTION dw.auto_create_wip_for_new_cluster();
```

### Commands and Verification

Run the migration:
```bash
cd /Users/damiengreen/Desktop/Data\ Warehouse
supabase db push
```

Create WIP products for existing clusters:
```sql
SELECT * FROM create_wip_products_for_clusters();
```

Expected: One row per product cluster, showing `created = true` for newly created WIP products.

Verify WIP products exist:
```sql
SELECT p.product_id, p.product_code, p.item_name, p.product_type,
       p.wip_for_cluster_id, c.cluster_label
FROM dw.dim_product p
JOIN dw.dim_cluster c ON p.wip_for_cluster_id = c.cluster_id
WHERE p.product_type = 'wip';
```

Expected: One row per product cluster with product names like "KiwiKlips Unpacked".

### Completion Criteria

- Function `create_wip_products_for_clusters()` exists and runs successfully
- Trigger auto-creates WIP product when new product cluster is added
- WIP products exist for all current product clusters
- Update Progress section, commit with message "Add WIP product creation function and trigger"

---

## Milestone 3: Update Supplier Portal to Include WIP Products

### Goal

Modify the supplier stock entry portal to show WIP products in a separate "Work in Progress" section. Suppliers can report stock levels for both finished products and WIP products.

### Prerequisites

- Milestone 2 complete (WIP products exist in database)
- Supplier portal functional at `/supplier/stock`

### Context for This Milestone

The supplier portal is implemented in:
- Backend: `api/main.py` endpoints `/api/supplier/products` and `/api/supplier/stock`
- Frontend: `frontend/src/pages/SupplierStock.tsx`

Current flow:
1. Frontend calls `GET /api/supplier/products` which returns products grouped by cluster
2. Supplier enters quantities
3. Frontend calls `POST /api/supplier/stock` to save entries

We need to:
1. Modify the API to return WIP products separately from finished products
2. Modify the frontend to display WIP products in their own section
3. Add production capacity input for WIP products

### Work

**Backend changes in `api/main.py`:**

Find the `ClusterWithProducts` model (around line 1251) and add a new model for WIP products:

```python
class WIPProduct(BaseModel):
    product_id: int
    product_code: str
    item_name: str
    cluster_id: int
    cluster_label: str
    production_capacity_per_day: Optional[float] = None
    current_week_qty: Optional[int] = None
    previous_week_qty: Optional[int] = None

class SupplierProductsResponse(BaseModel):
    clusters: List[ClusterWithProducts]
    wip_products: List[WIPProduct]
    week_ending: str
```

Modify the `get_supplier_products` endpoint to also fetch WIP products:

```python
@app.get("/api/supplier/products", response_model=SupplierProductsResponse)
async def get_supplier_products(current_user = Depends(require_role(["supplier", "super_user"]))):
    # ... existing code for finished products ...

    # Fetch WIP products
    cur.execute("""
        SELECT p.product_id, p.product_code, p.item_name,
               p.wip_for_cluster_id as cluster_id, c.cluster_label,
               p.production_capacity_per_day
        FROM dw.dim_product p
        JOIN dw.dim_cluster c ON p.wip_for_cluster_id = c.cluster_id
        WHERE p.product_type = 'wip'
          AND p.archived = false
        ORDER BY c.cluster_label
    """)
    wip_rows = cur.fetchall()

    # Get WIP stock entries for current user
    # ... similar pattern to finished products ...
```

**Frontend changes in `frontend/src/pages/SupplierStock.tsx`:**

Add state for WIP products:
```typescript
const [wipProducts, setWipProducts] = useState<WIPProduct[]>([]);
const [wipQuantities, setWipQuantities] = useState<Record<number, string>>({});
```

Add a new section in the UI for WIP products:
```tsx
{/* Work in Progress Section */}
{wipProducts.length > 0 && (
    <div className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Work in Progress (Unpacked Stock)
        </h2>
        <p className="text-sm text-gray-500 mb-4">
            Enter the quantity of unpacked/bulk product you have available
        </p>
        {/* Similar table structure as finished products */}
    </div>
)}
```

**Add production capacity editing (admin only):**

Create a new component or add to ClusterManagement for editing WIP product capacity.

### Commands and Verification

Run the backend:
```bash
cd /Users/damiengreen/Desktop/Data\ Warehouse
uvicorn api.main:app --reload --port 8001
```

Run the frontend:
```bash
cd frontend && npm run dev
```

Test as a supplier user:
1. Log in as a supplier
2. Navigate to `/supplier/stock`
3. Verify finished products appear grouped by cluster
4. Verify WIP products appear in a separate "Work in Progress" section
5. Enter quantities for both types and save
6. Refresh page and verify quantities persisted

### Completion Criteria

- Supplier portal shows WIP products in separate section
- Suppliers can enter and save WIP stock quantities
- WIP products show their associated cluster name
- Production capacity is displayed (editable by admin only)
- Update Progress section, commit with message "Add WIP products to supplier portal"

---

## Milestone 4: Update Report Queries to Exclude WIP Products

### Goal

Modify all report queries, views, and API endpoints to exclude WIP products from sales reports, price lists, and general product listings.

### Prerequisites

- Milestone 1 complete (product_type column exists)
- WIP products exist in database with product_type = 'wip'

### Context for This Milestone

Reports and queries that need modification:

1. **Sales reports** (`src/reporting/sales_report.py`): Uses `mart.sales_enriched` view
2. **Price lists** (`scripts/generate_price_list_pdf.py`): Direct query to `dw.dim_product`
3. **Customer price lists** (`api/main.py`): Various endpoints
4. **Products page** (`frontend/src/pages/Products.tsx`): Supabase query
5. **Product search/selection** components: Various locations
6. **Supplier products RPC** (`public.get_products_for_supplier_stock`): Should already work but verify

The `mart.sales_enriched` view is defined in migration `20251212_bulk_archive.sql`. We need to update it.

### Work

**Update mart.sales_enriched view:**

Create migration `supabase/migrations/20260121_exclude_wip_from_reports.sql`:

```sql
-- Update sales_enriched view to exclude WIP products
CREATE OR REPLACE VIEW mart.sales_enriched AS
SELECT
    -- existing columns
FROM dw.fct_sales_line sl
JOIN dw.dim_product p ON sl.product_id = p.product_id
-- ... existing joins ...
WHERE
    (p.archived IS DISTINCT FROM true)
    AND (p.product_type IS DISTINCT FROM 'wip')  -- NEW: exclude WIP
    -- ... existing conditions ...
;
```

**Update price list generator (`scripts/generate_price_list_pdf.py`):**

Find the `fetch_products` function and add filter:
```python
WHERE archived = false
  AND is_tracked_as_inventory = true
  AND (product_type IS NULL OR product_type = 'finished')
```

**Update API endpoints (`api/main.py`):**

Find all queries to `dw.dim_product` and add the filter. Locations include:
- Customer price list endpoints
- Product search endpoints
- Any product listing endpoints

**Update frontend Products.tsx:**

Add filter to the Supabase query:
```typescript
.or('product_type.is.null,product_type.eq.finished')
```

**Update supplier products RPC:**

Modify `public.get_products_for_supplier_stock()` to only return finished products (WIP products handled separately now).

### Commands and Verification

Run migrations:
```bash
supabase db push
```

Test exclusion:
```sql
-- Verify WIP products not in sales_enriched
SELECT DISTINCT p.product_type
FROM mart.sales_enriched se
JOIN dw.dim_product p ON se.product_id = p.product_id;
-- Should only show 'finished' or NULL

-- Verify WIP products exist but excluded
SELECT product_type, COUNT(*)
FROM dw.dim_product
WHERE archived = false
GROUP BY product_type;
-- Should show counts for both 'finished' and 'wip'
```

Test UI:
1. Products page should not show "XXX Unpacked" products
2. Price list PDF should not include WIP products
3. Customer price list should not include WIP products

### Completion Criteria

- WIP products excluded from `mart.sales_enriched` view
- WIP products excluded from price list generation
- WIP products excluded from Products.tsx page
- WIP products excluded from all customer-facing product lists
- Update Progress section, commit with message "Exclude WIP products from reports and price lists"

---

## Milestone 5: Comprehensive Stock Aggregation UI

### Goal

Create a new RPC and update ClusterAnalytics to show comprehensive stock totals: our stock + supplier finished stock + supplier WIP stock + production capacity. Demand-based calculations are out of scope for this milestone.

### Prerequisites

- Milestones 1-4 complete
- Supplier stock entries exist (at least test data)

### Context for This Milestone

Current cluster analytics RPC `get_product_cluster_summary()` in `supabase/migrations/20260119_cluster_analytics_rpcs.sql` only shows our stock (`quantity_on_hand` from `dim_product`).

We need to add:
- Total supplier finished stock (sum across all suppliers, current week)
- Total supplier WIP stock (sum across all suppliers, current week)
- Production capacity (units per day from WIP products)

### Work

**Create new RPC for comprehensive stock totals:**

Add to `supabase/migrations/20260121_stock_aggregation.sql`:

```sql
CREATE OR REPLACE FUNCTION public.get_cluster_stock_totals()
RETURNS TABLE (
    cluster_id int,
    cluster_label text,
    base_unit_label text,
    -- Our stock
    our_units_on_hand numeric,
    -- Supplier finished stock (all suppliers combined)
    supplier_finished_units numeric,
    -- Supplier WIP stock
    supplier_wip_units numeric,
    -- Total available now
    total_available_units numeric,
    -- Production capacity
    production_capacity_per_day numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH cluster_data AS (
        SELECT
            c.cluster_id,
            c.cluster_label,
            c.base_unit_label
        FROM dw.dim_cluster c
        WHERE c.cluster_type = 'product'
    ),
    our_stock AS (
        -- Our inventory (finished products only)
        SELECT
            pc.cluster_id,
            SUM(COALESCE(p.quantity_on_hand, 0) * pc.unit_multiplier) as units
        FROM dw.dim_product_cluster pc
        JOIN dw.dim_product p ON p.product_id = pc.product_id
        WHERE (p.product_type IS NULL OR p.product_type = 'finished')
          AND p.archived = false
        GROUP BY pc.cluster_id
    ),
    supplier_finished AS (
        -- Supplier stock of finished products (current week)
        SELECT
            pc.cluster_id,
            SUM(COALESCE(sse.quantity_on_hand, 0) * pc.unit_multiplier) as units
        FROM dw.supplier_stock_entry sse
        JOIN dw.dim_product p ON p.product_id = sse.product_id
        JOIN dw.dim_product_cluster pc ON pc.product_id = p.product_id
        WHERE (p.product_type IS NULL OR p.product_type = 'finished')
          AND sse.week_ending = dw.get_week_ending(CURRENT_DATE)
        GROUP BY pc.cluster_id
    ),
    supplier_wip AS (
        -- Supplier WIP stock (current week)
        SELECT
            p.wip_for_cluster_id as cluster_id,
            SUM(COALESCE(sse.quantity_on_hand, 0)) as units
        FROM dw.supplier_stock_entry sse
        JOIN dw.dim_product p ON p.product_id = sse.product_id
        WHERE p.product_type = 'wip'
          AND sse.week_ending = dw.get_week_ending(CURRENT_DATE)
        GROUP BY p.wip_for_cluster_id
    ),
    production_capacity AS (
        -- Production capacity from WIP products
        SELECT
            p.wip_for_cluster_id as cluster_id,
            SUM(COALESCE(p.production_capacity_per_day, 0)) as capacity
        FROM dw.dim_product p
        WHERE p.product_type = 'wip'
          AND p.archived = false
        GROUP BY p.wip_for_cluster_id
    )
    SELECT
        cd.cluster_id,
        cd.cluster_label,
        cd.base_unit_label,
        COALESCE(os.units, 0) as our_units_on_hand,
        COALESCE(sf.units, 0) as supplier_finished_units,
        COALESCE(sw.units, 0) as supplier_wip_units,
        COALESCE(os.units, 0) + COALESCE(sf.units, 0) + COALESCE(sw.units, 0) as total_available_units,
        COALESCE(pc.capacity, 0) as production_capacity_per_day
    FROM cluster_data cd
    LEFT JOIN our_stock os ON os.cluster_id = cd.cluster_id
    LEFT JOIN supplier_finished sf ON sf.cluster_id = cd.cluster_id
    LEFT JOIN supplier_wip sw ON sw.cluster_id = cd.cluster_id
    LEFT JOIN production_capacity pc ON pc.cluster_id = cd.cluster_id
    ORDER BY cd.cluster_label;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_cluster_stock_totals() TO authenticated;

COMMENT ON FUNCTION public.get_cluster_stock_totals() IS
'Returns comprehensive stock totals for each product cluster including our stock, supplier finished stock, supplier WIP stock, and production capacity.';
```

**Update ClusterAnalytics.tsx:**

Add new interface:
```typescript
interface ClusterStockTotals {
    cluster_id: number;
    cluster_label: string;
    base_unit_label: string | null;
    our_units_on_hand: number;
    supplier_finished_units: number;
    supplier_wip_units: number;
    total_available_units: number;
    production_capacity_per_day: number;
}
```

Add new section showing breakdown for selected cluster:
```
Stock Position
├── Our Stock: 50,000 clips
├── Supplier Finished: 35,000 clips
├── Supplier WIP: 180,000 clips
├── ─────────────────────────
├── Total Available: 265,000 clips
└── Production Capacity: 3,000 clips/day
```

Update cluster summary cards to show total available including WIP.

### Commands and Verification

Run migration:
```bash
supabase db push
```

Test RPC:
```sql
SELECT * FROM get_cluster_stock_totals();
```

Expected: One row per cluster showing all stock source breakdowns.

Test UI:
1. Navigate to Cluster Analytics
2. Select a cluster
3. Verify stock breakdown shows our stock, supplier finished, supplier WIP
4. Verify totals sum correctly

### Completion Criteria

- New `get_cluster_stock_totals()` RPC returns comprehensive data
- ClusterAnalytics UI shows breakdown of all stock sources
- Total available includes all three stock sources
- Production capacity displayed (for future demand planning)
- Update Progress section, commit with message "Add comprehensive stock aggregation UI"

---

## Interfaces and Dependencies

### Database Schema Additions

**New columns on `dw.dim_product`:**
- `product_type text DEFAULT 'finished'` - 'finished' or 'wip'
- `wip_for_cluster_id integer REFERENCES dw.dim_cluster(cluster_id)` - links WIP to cluster
- `production_capacity_per_day numeric(18,2)` - max units producible per day

**New constraint:**
- `chk_wip_product_has_cluster` - ensures WIP products have cluster link

### New Database Functions

- `public.create_wip_products_for_clusters()` - generates WIP products
- `public.get_cluster_stock_totals()` - comprehensive stock totals
- `dw.auto_create_wip_for_new_cluster()` - trigger function

### API Changes

- `GET /api/supplier/products` - returns both finished and WIP products
- Response model extended with `wip_products` array

### TypeScript Interfaces

```typescript
interface WIPProduct {
    product_id: number;
    product_code: string;
    item_name: string;
    cluster_id: number;
    cluster_label: string;
    production_capacity_per_day: number | null;
    current_week_qty: number | null;
    previous_week_qty: number | null;
}

interface ClusterStockTotals {
    cluster_id: number;
    cluster_label: string;
    base_unit_label: string | null;
    our_units_on_hand: number;
    supplier_finished_units: number;
    supplier_wip_units: number;
    total_available_units: number;
    production_capacity_per_day: number;
}
```

## Idempotence and Recovery

**All migrations are idempotent:**
- Column additions use `ADD COLUMN IF NOT EXISTS`
- Index creation uses `CREATE INDEX IF NOT EXISTS`
- Function creation uses `CREATE OR REPLACE`
- Constraint addition can be wrapped in conditional logic

**WIP product creation is safe to run multiple times:**
- Function checks for existing WIP product before creating
- Returns info about whether each product was created or already existed

**If a milestone fails partway:**
- Database changes can be rolled back via migration revert
- Frontend changes have no persistent state
- Re-running the migration from scratch is safe

## Artifacts and Notes

### Example WIP Product

After Milestone 2, for a cluster "KiwiKlips" with cluster_id=1:
```sql
product_id: 9000001
product_code: 'KIWIKILPS_UNPACKED'
item_name: 'KiwiKlips Unpacked'
product_type: 'wip'
wip_for_cluster_id: 1
is_tracked_as_inventory: true
production_capacity_per_day: NULL (set later by admin)
```

### Example Stock Aggregation

Cluster: KiwiKlips (base_unit_label: 'clips')
- Our stock: 50,000 clips
- Supplier A finished: 20,000 clips
- Supplier B finished: 15,000 clips (total supplier finished: 35,000)
- Supplier A WIP: 100,000 clips
- Supplier B WIP: 80,000 clips (total supplier WIP: 180,000)
- **Total available: 265,000 clips**
- Production capacity: 3,000 clips/day

Note: Demand-based calculations (days of cover, projections) are out of scope for this implementation. The production capacity field is stored for future demand planning features.

### Migration File Summary

1. `20260120_wip_products.sql` - Schema changes + creation function (M1, M2)
2. `20260121_exclude_wip_from_reports.sql` - Report exclusions (M4)
3. `20260121_stock_aggregation.sql` - Stock totals RPC (M5)
