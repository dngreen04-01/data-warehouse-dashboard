# Product Cluster Unit Multipliers for Production Planning

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with PLANS.md at docs/Plans.md.

## Purpose / Big Picture

Currently, product clusters in the Data Warehouse are flat categorical groupings (e.g., "Cotton Products"). For production planning, we need to track how many **base units** each product variant represents. For example, "KiwiKlip 1000" contains 1,000 individual clips, while "KiwiKlip 20000" contains 20,000 clips.

After this change, users can:

1. **Assign unit multipliers** when adding products to clusters (e.g., KiwiKlip 1000 = 1000 units, KiwiKlip 20000 = 20000 units)
2. **View aggregated totals** showing total base units sold and in stock across all variants in a cluster
3. **Understand true demand** - instead of seeing "50 units sold" of mixed variants, see "850,000 clips sold" for production planning

This foundation enables future modules: Production Planning (how much to produce), Forecasting (predict demand in base units), Stock Holding (total units across locations), and Production Capacity (output per machine hour).

## Progress

- [x] Milestone 1: Database schema extensions for unit multipliers (2026-01-19)
- [x] Milestone 2: Backend RPCs for aggregated cluster analytics (2026-01-19)
- [x] Milestone 3: Frontend - Unit multiplier capture in ClusterManagement (2026-01-19)
- [ ] Milestone 4: Frontend - Cluster analytics dashboard component

## Surprises & Discoveries

(To be populated during implementation.)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-19 | Add `unit_multiplier` to dim_product_cluster rather than dim_product | Keeps variant relationship explicit to cluster context; same product could theoretically have different multipliers in different cluster types |
| 2026-01-19 | Add `base_unit_label` to dim_cluster | Allows human-readable reporting ("clips", "meters", "grams") per cluster |
| 2026-01-19 | Make base_unit_label optional with default 'units' | User preference - reduces friction when creating clusters, can be edited later |
| 2026-01-19 | Create separate analytics views rather than modifying existing | Non-breaking change; existing reports continue to work |
| 2026-01-19 | Store multiplier as NUMERIC(18,4) | Supports fractional units if needed (e.g., 0.5kg bags) |

## Outcomes & Retrospective

### Milestone 1 (2026-01-19)
- Created migration `20260119_cluster_unit_multipliers.sql` with all schema changes
- Added `unit_multiplier NUMERIC(18,4) DEFAULT 1` to `dim_product_cluster` with CHECK > 0
- Added `base_unit_label TEXT DEFAULT 'units'` to `dim_cluster`
- Created index on `(cluster_id, product_id)` for efficient aggregation
- Updated `create_cluster` RPC to accept `p_base_unit_label` parameter
- Updated `get_clusters_by_type` RPC to return `base_unit_label`
- Updated `manage_cluster_member` RPC to accept `p_unit_multiplier` parameter
- Updated `get_cluster_members` RPC to return `unit_multiplier` for products
- Created `update_product_unit_multiplier` RPC for editing multipliers
- Created `update_cluster_base_unit_label` RPC for editing cluster unit labels

### Milestone 2 (2026-01-19)
- Created migration `20260119_cluster_analytics_rpcs.sql` with all analytics functions
- **get_product_cluster_summary()**: Returns aggregated stats for all product clusters
  - Includes: product_count, total_units_on_hand, total_units_sold_30d/90d, total_revenue_30d/90d
  - Uses CTEs for efficient calculation across cluster products, sales, and inventory
- **get_cluster_product_details(p_cluster_id)**: Returns products within a cluster
  - Shows: raw quantities, unit_multiplier, and calculated base units (units_on_hand, units_sold_30d)
  - Includes revenue_30d for each product
- **get_cluster_sales_timeseries(p_cluster_id, p_start_date, p_end_date)**: Daily time series
  - Uses generate_series for continuous date range (no gaps on days without sales)
  - Returns total_units_sold and total_revenue per day
- **mart.cluster_units_summary view**: Dashboard-ready summary view
  - Includes calculated `estimated_days_of_stock` based on 30-day sales rate
  - Returns 0 for metrics when no data (not NULL)

### Milestone 3 (2026-01-19)
- Updated `ClusterManagement.tsx` with full unit multiplier support
- **Interfaces extended**: `Cluster` now includes `base_unit_label`, `Member` includes `unit_multiplier`
- **Cluster creation**: Product clusters now show base unit label input (e.g., "clips", "meters", "grams")
- **Product addition modal**: When adding products to a cluster, a modal prompts for the unit multiplier
  - Shows helpful example: "KiwiKlip 1000 = 1000 clips"
  - Validates multiplier > 0 before submission
- **Members table enhancements**:
  - Added "Unit Multiplier" column for product clusters
  - Displays formatted multiplier with base unit label (e.g., "×1,000 clips")
  - Inline editing with input validation
- **Base unit label editing**: Click to edit base unit label in cluster header
- **RPC integration**:
  - `createCluster` passes `p_base_unit_label` for product clusters
  - `manage_cluster_member` passes `p_unit_multiplier` when adding products
  - `update_product_unit_multiplier` called for inline multiplier edits
  - `update_cluster_base_unit_label` called for base unit updates

## Context and Orientation

### Current Database Schema

All tables are in the `dw` schema. Key tables for this feature:

**dw.dim_cluster** - Master cluster table
```sql
cluster_id (integer, PK)
cluster_label (text)           -- e.g., "KiwiKlip Products"
cluster_type (text)            -- 'customer' or 'product'
updated_at (timestamptz)
```

**dw.dim_product_cluster** - Product-to-cluster mapping
```sql
product_id (bigint, PK)        -- One product can only belong to one cluster
cluster_id (int, FK)
created_at (timestamptz)
```

**dw.dim_product** - Product dimension
```sql
product_id (bigint, PK)
product_code (text)            -- SKU
item_name (text)
quantity_on_hand (numeric)     -- Current inventory
...
```

**dw.fct_sales_line** - Sales transactions
```sql
sales_line_id (bigint, PK)
product_id (bigint)
qty (numeric 18,4)             -- Quantity sold
line_amount (numeric)
invoice_date (date)
...
```

### Current Frontend Architecture

The ClusterManagement page (`frontend/src/pages/ClusterManagement.tsx`) provides:
- Tab-based navigation between customer and product clusters
- Two-pane layout: cluster list (left) + member management (right)
- Search and add products to clusters
- Uses Supabase RPCs: `create_cluster`, `get_clusters_by_type`, `get_cluster_members`, `manage_cluster_member`

### File Paths

- Migrations: `/supabase/migrations/`
- Views: `/supabase/views.sql` (mart schema views)
- Frontend pages: `/frontend/src/pages/`
- Supabase client: `/frontend/src/lib/supabase.ts`

---

## Milestone 1: Database Schema Extensions for Unit Multipliers

### Goal

Add `unit_multiplier` column to `dim_product_cluster` and `base_unit_label` column to `dim_cluster`. After this milestone, the database can store unit conversion data, though no UI captures it yet.

### Prerequisites

- Database access to run migrations
- Current schema has `dw.dim_cluster` and `dw.dim_product_cluster` tables

### Context for This Milestone

The `dim_product_cluster` table currently only has `product_id`, `cluster_id`, and `created_at`. We add:
- `unit_multiplier NUMERIC(18,4) DEFAULT 1` - How many base units this product represents
- Update the `dim_cluster` table with `base_unit_label TEXT` - Human-readable unit name for product clusters

### Work

Create migration file `/supabase/migrations/20260119_cluster_unit_multipliers.sql`:

1. Add `unit_multiplier` column to `dim_product_cluster` with default of 1 (existing records get 1x multiplier)
2. Add `base_unit_label` column to `dim_cluster` with DEFAULT 'units' (only meaningful for product clusters)
3. Add CHECK constraint ensuring `unit_multiplier > 0`
4. Create index on `(cluster_id, product_id)` for efficient cluster aggregation queries
5. Update the `manage_cluster_member` RPC to accept optional `p_unit_multiplier` parameter
6. Create new RPC `update_product_unit_multiplier(p_product_id, p_unit_multiplier)` for editing multipliers after assignment

### Commands and Verification

```bash
# From project root, apply migration
supabase db push

# Verify columns exist
psql -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='dw' AND table_name='dim_product_cluster';"

# Verify default value applied to existing records
psql -c "SELECT COUNT(*) FROM dw.dim_product_cluster WHERE unit_multiplier = 1;"
```

Expected: All existing records have `unit_multiplier = 1`.

### Completion Criteria

- [x] Migration file created and applied without errors
- [x] `dim_product_cluster.unit_multiplier` column exists with default 1
- [x] `dim_cluster.base_unit_label` column exists
- [x] `manage_cluster_member` RPC accepts optional unit_multiplier
- [x] `update_product_unit_multiplier` RPC exists and works
- [x] Update Progress section, commit with message "Add unit multiplier support to product clusters schema"

---

## Milestone 2: Backend RPCs for Aggregated Cluster Analytics

### Goal

Create database functions that aggregate sales and inventory by cluster, applying unit multipliers. After this milestone, the backend can return data like "KiwiKlip cluster: 850,000 units sold, 120,000 units in stock."

### Prerequisites

- Milestone 1 complete: `unit_multiplier` column exists in `dim_product_cluster`
- `base_unit_label` column exists in `dim_cluster`

### Context for This Milestone

We need RPCs that:
1. Return aggregated stats per product cluster (total units sold, total units in stock)
2. Return time-series sales data aggregated by cluster in base units
3. Support filtering by date range

**Key tables involved:**
- `dw.dim_product_cluster` - has `product_id`, `cluster_id`, `unit_multiplier`
- `dw.dim_product` - has `quantity_on_hand` (current stock)
- `dw.fct_sales_line` - has `qty` (quantity sold per transaction), `invoice_date`
- `dw.dim_cluster` - has `cluster_label`, `base_unit_label`

### Work

Create migration file `/supabase/migrations/20260119_cluster_analytics_rpcs.sql`:

1. **RPC: get_product_cluster_summary()**
   Returns for each product cluster:
   - `cluster_id`, `cluster_label`, `base_unit_label`
   - `product_count` - number of products in cluster
   - `total_units_on_hand` - SUM(quantity_on_hand * unit_multiplier)
   - `total_units_sold_30d` - SUM(qty * unit_multiplier) for last 30 days
   - `total_units_sold_90d` - SUM(qty * unit_multiplier) for last 90 days
   - `total_revenue_30d`, `total_revenue_90d`

2. **RPC: get_cluster_product_details(p_cluster_id)**
   Returns products within a cluster with:
   - `product_id`, `product_code`, `item_name`
   - `unit_multiplier`
   - `quantity_on_hand`, `units_on_hand` (qty * multiplier)
   - `qty_sold_30d`, `units_sold_30d` (qty * multiplier)
   - `revenue_30d`

3. **RPC: get_cluster_sales_timeseries(p_cluster_id, p_start_date, p_end_date)**
   Returns daily/weekly aggregation:
   - `period_date`
   - `total_units_sold` (SUM of qty * multiplier)
   - `total_revenue`

4. **Create mart.cluster_units_summary view** as a materialized/regular view for dashboard widgets

### Commands and Verification

```bash
# Apply migration
supabase db push

# Test RPC returns data
psql -c "SELECT * FROM get_product_cluster_summary();"

# Verify calculation for a known cluster
psql -c "SELECT * FROM get_cluster_product_details(1);"  -- replace 1 with actual cluster_id
```

### Completion Criteria

- [x] All three RPCs created and return correct data types
- [x] Aggregations correctly apply unit_multiplier
- [x] RPCs handle clusters with no sales gracefully (return 0, not NULL)
- [x] View `mart.cluster_units_summary` created
- [x] Update Progress section, commit with message "Add cluster analytics RPCs with unit multiplier aggregation"

---

## Milestone 3: Frontend - Unit Multiplier Capture in ClusterManagement

### Goal

Update the ClusterManagement page to allow users to:
1. Set a `base_unit_label` when creating/editing product clusters (e.g., "clips", "units")
2. Enter `unit_multiplier` when adding a product to a cluster
3. Edit existing unit multipliers for products already in a cluster

### Prerequisites

- Milestones 1 & 2 complete (database columns and RPCs exist)
- Frontend dev server running (`cd frontend && npm run dev`)

### Context for This Milestone

**File to modify:** `/frontend/src/pages/ClusterManagement.tsx`

Current UI flow for adding a product to cluster:
1. User selects cluster from left panel
2. User searches for product in search box
3. User clicks product from search results → calls `manage_cluster_member` RPC

New flow:
1. Same as before, but when clicking to add a product...
2. A modal/dialog appears asking for the unit multiplier (default 1)
3. After adding, the members list shows the multiplier next to each product
4. User can edit multiplier inline

**TypeScript interfaces to update:**
```typescript
interface Member {
    id: string;
    name: string;
    unit_multiplier?: number;  // NEW
}

interface Cluster {
    cluster_id: number;
    cluster_label: string;
    cluster_type: string;
    member_count: number;
    base_unit_label?: string;  // NEW - only for product clusters
}
```

### Work

1. **Update Cluster interface** to include `base_unit_label`

2. **Update Member interface** to include `unit_multiplier`

3. **Modify fetchMembers()** to get unit_multiplier from the RPC response (requires updating `get_cluster_members` RPC to return it)

4. **Add base_unit_label input** when creating a product cluster:
   - Add text input field in cluster creation form for product clusters only
   - Pass to `create_cluster` RPC (update RPC to accept this parameter)

5. **Add unit_multiplier modal/popover** when adding product to cluster:
   - When user clicks on a search result to add, show a small popover/modal
   - Input field for multiplier (default 1), with label showing base_unit_label
   - Confirm button calls `manage_cluster_member` with the multiplier

6. **Display multiplier in members list**:
   - Show multiplier next to each product name (e.g., "KiwiKlip 1000 (×1,000 clips)")
   - Add edit button to modify multiplier inline
   - Edit triggers `update_product_unit_multiplier` RPC

7. **Update the cluster header** to show base_unit_label when a product cluster is selected

### Commands and Verification

```bash
# Start frontend dev server
cd frontend && npm run dev

# Navigate to http://localhost:5173/clusters
```

Manual verification steps:
1. Switch to "Product Clusters" tab
2. Create new cluster with name "KiwiKlip" and base unit "clips"
3. Select the cluster, search for a product
4. Add product with multiplier 1000 → verify it appears as "(×1,000 clips)"
5. Edit multiplier to 500 → verify update persists on refresh

### Completion Criteria

- [x] Product cluster creation shows base_unit_label input field
- [x] Adding product to cluster prompts for unit_multiplier
- [x] Members list displays multiplier with formatted number
- [x] Multiplier can be edited inline
- [x] Changes persist after page refresh
- [x] Update Progress section, commit with message "Add unit multiplier UI to ClusterManagement"

---

## Milestone 4: Frontend - Cluster Analytics Dashboard Component

### Goal

Create a new page/component that displays aggregated cluster analytics using the RPCs from Milestone 2. Users can see total units sold/available for each product cluster and drill down to individual products.

### Prerequisites

- Milestones 1-3 complete
- Cluster analytics RPCs functional

### Context for This Milestone

**New file:** `/frontend/src/pages/ClusterAnalytics.tsx`

This page will show:
1. **Summary cards** for each product cluster with key metrics
2. **Drill-down table** when a cluster is selected showing product-level details
3. **Time-series chart** showing units sold over time for selected cluster

**Routing:** Add route `/cluster-analytics` in App.tsx

**UI Components:**
- Summary card: cluster name, base unit label, total units on hand, units sold (30d)
- Product table: product code, name, multiplier, units on hand, units sold
- Line chart: daily/weekly units sold (use existing chart library if present)

### Work

1. **Create ClusterAnalytics.tsx page** with:
   - State for clusters summary (`get_product_cluster_summary`)
   - State for selected cluster details (`get_cluster_product_details`)
   - State for time-series data (`get_cluster_sales_timeseries`)

2. **Build summary cards grid**:
   - Fetch all product clusters with aggregated stats
   - Display card per cluster with: name, base unit, units on hand, units sold 30d
   - Format large numbers (e.g., 1.2M clips)
   - Click card to select for drill-down

3. **Build product details table**:
   - Shows when a cluster is selected
   - Columns: Product, Multiplier, Units On Hand, Units Sold (30d), Revenue
   - Sortable columns

4. **Build time-series chart** (optional, if time permits):
   - Simple line chart showing units sold per day/week
   - Date range selector

5. **Add navigation**:
   - Add route in App.tsx
   - Add link in Products page or sidebar

### Commands and Verification

```bash
cd frontend && npm run dev
# Navigate to http://localhost:5173/cluster-analytics
```

Manual verification:
1. Page loads with summary cards for all product clusters
2. Cards show correct aggregated metrics
3. Clicking a card shows product details table
4. Numbers are formatted appropriately (K, M suffixes)
5. Empty clusters show "0 units" not errors

### Completion Criteria

- [ ] ClusterAnalytics page created and accessible via route
- [ ] Summary cards display aggregated cluster data
- [ ] Product details table shows drill-down data with multipliers applied
- [ ] Numbers formatted for readability (1.2M, 50K)
- [ ] Navigation link added to reach the page
- [ ] No console errors
- Update Progress section, commit with message "Add Cluster Analytics dashboard for production planning"

---

## Interfaces and Dependencies

### Database Changes Summary

```sql
-- dim_product_cluster additions
unit_multiplier NUMERIC(18,4) DEFAULT 1 NOT NULL CHECK (unit_multiplier > 0)

-- dim_cluster additions
base_unit_label TEXT DEFAULT 'units'
```

### RPC Signatures

```sql
-- Updated RPC
manage_cluster_member(p_type, p_action, p_cluster_id, p_entity_id, p_unit_multiplier DEFAULT 1)

-- New RPCs
update_product_unit_multiplier(p_product_id BIGINT, p_unit_multiplier NUMERIC)
  RETURNS void

get_product_cluster_summary()
  RETURNS TABLE(cluster_id, cluster_label, base_unit_label, product_count,
                total_units_on_hand, total_units_sold_30d, total_units_sold_90d,
                total_revenue_30d, total_revenue_90d)

get_cluster_product_details(p_cluster_id INT)
  RETURNS TABLE(product_id, product_code, item_name, unit_multiplier,
                quantity_on_hand, units_on_hand, qty_sold_30d, units_sold_30d, revenue_30d)

get_cluster_sales_timeseries(p_cluster_id INT, p_start_date DATE, p_end_date DATE)
  RETURNS TABLE(period_date DATE, total_units_sold NUMERIC, total_revenue NUMERIC)
```

### TypeScript Types

```typescript
interface ProductClusterSummary {
    cluster_id: number;
    cluster_label: string;
    base_unit_label: string | null;
    product_count: number;
    total_units_on_hand: number;
    total_units_sold_30d: number;
    total_units_sold_90d: number;
    total_revenue_30d: number;
    total_revenue_90d: number;
}

interface ClusterProductDetail {
    product_id: number;
    product_code: string;
    item_name: string;
    unit_multiplier: number;
    quantity_on_hand: number;
    units_on_hand: number;
    qty_sold_30d: number;
    units_sold_30d: number;
    revenue_30d: number;
}
```

### Dependencies

- Supabase PostgreSQL (existing)
- React 18+ (existing)
- Tailwind CSS (existing)
- Lucide React icons (existing)
- No new npm packages required

---

## Idempotence and Recovery

All database migrations use `IF NOT EXISTS` and `CREATE OR REPLACE` patterns. Running migrations multiple times is safe.

If a migration fails partway:
1. Check Supabase migration log for error
2. Fix the SQL issue
3. Re-run `supabase db push`

Frontend changes are standard React - if deployment fails, previous version continues to work.

---

## Artifacts and Notes

### Example Unit Multiplier Calculation

For a "KiwiKlip" cluster with base_unit_label = "clips":

| Product | qty_on_hand | unit_multiplier | units_on_hand |
|---------|-------------|-----------------|---------------|
| KiwiKlip 1000 | 50 | 1,000 | 50,000 |
| KiwiKlip 20000 | 10 | 20,000 | 200,000 |
| **Cluster Total** | - | - | **250,000 clips** |

### SQL Aggregation Pattern

```sql
SELECT
    c.cluster_id,
    c.cluster_label,
    c.base_unit_label,
    SUM(p.quantity_on_hand * pc.unit_multiplier) as total_units_on_hand
FROM dw.dim_cluster c
JOIN dw.dim_product_cluster pc ON pc.cluster_id = c.cluster_id
JOIN dw.dim_product p ON p.product_id = pc.product_id
WHERE c.cluster_type = 'product'
GROUP BY c.cluster_id, c.cluster_label, c.base_unit_label;
```

---

## Future Module Integration Notes

This foundation supports planned modules:

1. **Production Planning**: Use `total_units_sold_30d` to calculate required production
2. **Forecasting**: Time-series data enables demand prediction per cluster
3. **Stock Holding**: `total_units_on_hand` can be extended to include supplier stock
4. **Production Capacity**: Link clusters to machines via new `dw.dim_machine` table with output rates per base unit
