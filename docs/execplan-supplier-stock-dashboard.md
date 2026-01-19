# Supplier Stock Holdings Dashboard

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with docs/Plans.md.

## Purpose / Big Picture

After this change, suppliers can log into a dedicated portal and enter their weekly stock holdings for all products they hold on our behalf. The data is stored so that we can view supplier stock levels alongside our own inventory in other parts of the application.

**User-visible behavior**: A supplier visits the portal, logs in with their email/password, sees a page showing all products grouped by Product Cluster (e.g., "Beverages", "Snacks"), and enters the quantity they currently have on hand for each product. The system shows what they entered last week for reference. When they click Save, the data is stored and they see a success confirmation.

## Progress

- [x] Milestone 1: Database schema for supplier stock entries and supplier role
- [x] Milestone 2: Backend API endpoints for stock data
- [x] Milestone 3: Supplier portal frontend with stock entry page

## Surprises & Discoveries

- AppLayout already had role-based rendering patterns (admin section for super_user) that made adding supplier navigation straightforward
- AuthContext path was `@/contexts/` not `@/context/` as initially expected
- Role badge display needed updating to show "Supplier" with appropriate orange color styling

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-20 | Use existing Supabase Auth with new 'supplier' role | Leverages existing RBAC system, avoids duplicate auth logic |
| 2026-01-20 | Show all products to all suppliers | Simpler implementation, suppliers can skip products they don't hold |
| 2026-01-20 | Weekly entry cadence with week-ending date | Matches typical supplier reporting cycles |
| 2026-01-20 | Store entries per week (not cumulative) | Enables historical tracking and "last week" comparison |

## Outcomes & Retrospective

**Completed**: All three milestones implemented successfully.

**Files Created/Modified**:
- `supabase/migrations/20260120_supplier_stock.sql` - Database schema and RPC functions
- `api/main.py` - Three new supplier API endpoints
- `frontend/src/pages/SupplierStock.tsx` - New supplier stock entry page
- `frontend/src/App.tsx` - Added supplier route and role-based redirect logic
- `frontend/src/components/layout/AppLayout.tsx` - Added supplier navigation and role badge

**Key Implementation Details**:
- Suppliers are automatically redirected to `/supplier/stock` when accessing internal pages
- Internal users see the standard navigation; suppliers see only supplier-specific navigation
- Super users can access the supplier portal for testing purposes
- Role badge shows "Supplier" with orange styling for visual distinction

## Context and Orientation

This section describes the current state of the codebase relevant to this feature.

### Product Clusters

Products are organized into clusters via two tables in the `dw` schema:

- **`dw.dim_cluster`**: Stores cluster definitions with `cluster_id`, `cluster_label`, and `cluster_type` ('product' or 'customer')
- **`dw.dim_product_cluster`**: Junction table linking `product_id` to `cluster_id`

Each product can belong to at most one product cluster. Products without a cluster assignment will be shown under an "Unclustered" section.

### Products

The `dw.dim_product` table contains all products with key fields:
- `product_id` (bigint): Primary key
- `product_code` (text): SKU code displayed to users
- `item_name` (text): Product title
- `archived` (boolean): Filter out archived products
- `is_tracked_as_inventory` (boolean): Only inventory-tracked products are relevant

### Existing RBAC System

The application uses a role-based access control system in the `dw` schema:

- **`dw.app_roles`**: Defines available roles (`super_user`, `administration`, `sales`)
- **`dw.user_roles`**: Links `auth.users` to app roles (one role per user)
- **`dw.permissions`**: Granular permissions
- **`dw.role_permissions`**: Maps roles to permissions

Frontend uses `AuthContext` to decode JWT tokens containing `user_role` and `permissions` claims. The `PermissionGate` component and `usePermission()` hook control access.

### Current Frontend Structure

- React 19 + TypeScript + Vite
- Routing via React Router v7
- Styling with Tailwind CSS
- Tables use native HTML `<table>` with filtering and sorting
- Modals for editing data
- Data fetched via Supabase client with `.schema('dw')` prefix

### Current Backend Structure

- FastAPI at `/api/main.py`
- Auth middleware in `/api/auth.py` with `require_auth`, `require_role`, `require_permission` decorators
- Database connections via `psycopg` using `SUPABASE_CONNECTION_STRING`

---

## Milestone 1: Database Schema for Supplier Stock Entries

### Goal

Create the database infrastructure to store supplier stock entries and add the 'supplier' role to the RBAC system. At the end of this milestone, the database can store weekly stock entries linked to suppliers and products.

### Prerequisites

- Database access via Supabase migrations
- Existing RBAC tables (`dw.app_roles`, `dw.user_roles`) are in place

### Context for This Milestone

**Tables to reference:**
- `dw.app_roles` at path `supabase/migrations/20260114_rbac_system.sql`
- `dw.dim_product` for product_id foreign key
- `auth.users` for user_id (supplier accounts)

**Week calculation**: Entries are stored by the "week ending" date (Saturday). This allows consistent weekly comparisons.

### Work

Create a new migration file `supabase/migrations/20260120_supplier_stock.sql` with the following:

1. **Add 'supplier' role to app_roles**:
   ```sql
   INSERT INTO dw.app_roles (role_id, role_name, description, is_system_role)
   VALUES ('supplier', 'Supplier', 'External supplier with portal access', false)
   ON CONFLICT (role_id) DO NOTHING;
   ```

2. **Create supplier_stock_entry table**:
   ```sql
   CREATE TABLE dw.supplier_stock_entry (
       id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id uuid NOT NULL REFERENCES auth.users(id),
       product_id bigint NOT NULL REFERENCES dw.dim_product(product_id),
       quantity_on_hand integer NOT NULL DEFAULT 0,
       week_ending date NOT NULL,
       created_at timestamptz DEFAULT now(),
       updated_at timestamptz DEFAULT now(),
       UNIQUE (user_id, product_id, week_ending)
   );
   ```
   The unique constraint prevents duplicate entries for the same supplier/product/week.

3. **Create helper function to get current week ending date**:
   ```sql
   CREATE OR REPLACE FUNCTION dw.get_week_ending(d date DEFAULT CURRENT_DATE)
   RETURNS date AS $$
   BEGIN
       -- Returns the Saturday of the week containing date d
       -- PostgreSQL: dow 0=Sunday, 6=Saturday
       RETURN d + (6 - EXTRACT(dow FROM d)::integer);
   END;
   $$ LANGUAGE plpgsql IMMUTABLE;
   ```

4. **Create RPC function to get products with clusters for supplier view**:
   ```sql
   CREATE OR REPLACE FUNCTION public.get_products_for_supplier_stock()
   RETURNS TABLE (
       product_id bigint,
       product_code text,
       item_name text,
       cluster_id integer,
       cluster_label text
   ) AS $$
   BEGIN
       RETURN QUERY
       SELECT
           p.product_id,
           p.product_code,
           p.item_name,
           c.cluster_id,
           c.cluster_label
       FROM dw.dim_product p
       LEFT JOIN dw.dim_product_cluster pc ON p.product_id = pc.product_id
       LEFT JOIN dw.dim_cluster c ON pc.cluster_id = c.cluster_id AND c.cluster_type = 'product'
       WHERE p.archived = false
         AND p.is_tracked_as_inventory = true
       ORDER BY c.cluster_label NULLS LAST, p.item_name;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   GRANT EXECUTE ON FUNCTION public.get_products_for_supplier_stock() TO authenticated;
   ```

5. **Create RPC function to get supplier's stock entries for current and previous week**:
   ```sql
   CREATE OR REPLACE FUNCTION public.get_supplier_stock_entries(p_user_id uuid)
   RETURNS TABLE (
       product_id bigint,
       current_week_qty integer,
       previous_week_qty integer
   ) AS $$
   DECLARE
       v_current_week date;
       v_previous_week date;
   BEGIN
       v_current_week := dw.get_week_ending(CURRENT_DATE);
       v_previous_week := v_current_week - 7;

       RETURN QUERY
       SELECT
           p.product_id,
           curr.quantity_on_hand as current_week_qty,
           prev.quantity_on_hand as previous_week_qty
       FROM dw.dim_product p
       LEFT JOIN dw.supplier_stock_entry curr
           ON p.product_id = curr.product_id
           AND curr.user_id = p_user_id
           AND curr.week_ending = v_current_week
       LEFT JOIN dw.supplier_stock_entry prev
           ON p.product_id = prev.product_id
           AND prev.user_id = p_user_id
           AND prev.week_ending = v_previous_week
       WHERE p.archived = false
         AND p.is_tracked_as_inventory = true;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   GRANT EXECUTE ON FUNCTION public.get_supplier_stock_entries(uuid) TO authenticated;
   ```

6. **Create RPC function to save stock entries**:
   ```sql
   CREATE OR REPLACE FUNCTION public.save_supplier_stock_entries(
       p_entries jsonb  -- Array of {product_id, quantity_on_hand}
   )
   RETURNS void AS $$
   DECLARE
       v_user_id uuid;
       v_week_ending date;
       v_entry jsonb;
   BEGIN
       v_user_id := auth.uid();
       v_week_ending := dw.get_week_ending(CURRENT_DATE);

       FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries)
       LOOP
           INSERT INTO dw.supplier_stock_entry (user_id, product_id, quantity_on_hand, week_ending)
           VALUES (
               v_user_id,
               (v_entry->>'product_id')::bigint,
               (v_entry->>'quantity_on_hand')::integer,
               v_week_ending
           )
           ON CONFLICT (user_id, product_id, week_ending)
           DO UPDATE SET
               quantity_on_hand = EXCLUDED.quantity_on_hand,
               updated_at = now();
       END LOOP;
   END;
   $$ LANGUAGE plpgsql SECURITY DEFINER;

   GRANT EXECUTE ON FUNCTION public.save_supplier_stock_entries(jsonb) TO authenticated;
   ```

7. **Add RLS policies**:
   ```sql
   ALTER TABLE dw.supplier_stock_entry ENABLE ROW LEVEL SECURITY;

   -- Suppliers can only see their own entries
   CREATE POLICY supplier_stock_select ON dw.supplier_stock_entry
       FOR SELECT USING (auth.uid() = user_id);

   -- Suppliers can insert their own entries
   CREATE POLICY supplier_stock_insert ON dw.supplier_stock_entry
       FOR INSERT WITH CHECK (auth.uid() = user_id);

   -- Suppliers can update their own entries
   CREATE POLICY supplier_stock_update ON dw.supplier_stock_entry
       FOR UPDATE USING (auth.uid() = user_id);
   ```

### Commands and Verification

From the project root:

```bash
# Apply the migration
npx supabase db push

# Or if using local Supabase
npx supabase migration up
```

Verify by connecting to the database and running:

```sql
-- Check supplier role exists
SELECT * FROM dw.app_roles WHERE role_id = 'supplier';

-- Check table exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'dw' AND table_name = 'supplier_stock_entry';

-- Test week ending function
SELECT dw.get_week_ending('2026-01-20'); -- Should return 2026-01-24 (Saturday)
```

### Completion Criteria

- Migration file created at `supabase/migrations/20260120_supplier_stock.sql`
- Migration applied successfully
- 'supplier' role exists in `dw.app_roles`
- `dw.supplier_stock_entry` table exists with correct columns and constraints
- `dw.get_week_ending()` function returns the correct Saturday
- RPC functions are callable by authenticated users
- RLS policies are in place

Upon completion: Update Progress section, commit with message "Add supplier stock entry schema and role".

---

## Milestone 2: Backend API Endpoints for Stock Data

### Goal

Create FastAPI endpoints that the supplier portal will use to fetch products grouped by cluster and submit stock entries. At the end of this milestone, the API can serve product data organized by cluster and accept stock entry submissions.

### Prerequisites

- Milestone 1 complete: database tables and RPC functions exist
- Backend server can connect to database

### Context for This Milestone

**File to modify**: `api/main.py`

**Auth middleware available** (from `api/auth.py`):
- `require_auth`: Returns `UserClaims` with `sub`, `email`, `user_role`, `permissions`
- `require_role(["role1", "role2"])`: Restricts to specific roles

**Existing patterns**:
- Pydantic models for request/response validation
- `get_db_connection()` for database access
- JSON responses with proper error handling

### Work

1. **Add Pydantic models** at the top of `api/main.py` (near other model definitions):

   ```python
   from pydantic import BaseModel
   from typing import Optional

   class ProductForStock(BaseModel):
       product_id: int
       product_code: str
       item_name: str
       cluster_id: Optional[int]
       cluster_label: Optional[str]
       current_week_qty: Optional[int]
       previous_week_qty: Optional[int]

   class ClusterWithProducts(BaseModel):
       cluster_id: Optional[int]
       cluster_label: str
       products: list[ProductForStock]

   class StockEntry(BaseModel):
       product_id: int
       quantity_on_hand: int

   class SaveStockRequest(BaseModel):
       entries: list[StockEntry]
   ```

2. **Add GET endpoint for products grouped by cluster**:

   ```python
   @app.get("/api/supplier/products", response_model=list[ClusterWithProducts])
   async def get_supplier_products(current_user: UserClaims = Depends(require_role(["supplier", "super_user"]))):
       """Get all products grouped by cluster for supplier stock entry."""
       conn = get_db_connection()
       try:
           with conn.cursor() as cur:
               # Get products with cluster info
               cur.execute("""
                   SELECT
                       p.product_id,
                       p.product_code,
                       p.item_name,
                       c.cluster_id,
                       c.cluster_label
                   FROM dw.dim_product p
                   LEFT JOIN dw.dim_product_cluster pc ON p.product_id = pc.product_id
                   LEFT JOIN dw.dim_cluster c ON pc.cluster_id = c.cluster_id AND c.cluster_type = 'product'
                   WHERE p.archived = false
                     AND p.is_tracked_as_inventory = true
                   ORDER BY c.cluster_label NULLS LAST, p.item_name
               """)
               products = cur.fetchall()

               # Get stock entries for this user
               cur.execute("""
                   SELECT product_id, current_week_qty, previous_week_qty
                   FROM public.get_supplier_stock_entries(%s)
               """, (current_user.sub,))
               stock_entries = {row[0]: {"current": row[1], "previous": row[2]} for row in cur.fetchall()}

               # Group by cluster
               clusters = {}
               for row in products:
                   product_id, product_code, item_name, cluster_id, cluster_label = row

                   # Use "Unclustered" for products without a cluster
                   key = cluster_id if cluster_id else 0
                   label = cluster_label if cluster_label else "Unclustered"

                   if key not in clusters:
                       clusters[key] = {
                           "cluster_id": cluster_id,
                           "cluster_label": label,
                           "products": []
                       }

                   stock = stock_entries.get(product_id, {"current": None, "previous": None})
                   clusters[key]["products"].append({
                       "product_id": product_id,
                       "product_code": product_code,
                       "item_name": item_name,
                       "cluster_id": cluster_id,
                       "cluster_label": cluster_label,
                       "current_week_qty": stock["current"],
                       "previous_week_qty": stock["previous"]
                   })

               # Sort clusters: named clusters first (alphabetically), then Unclustered
               result = sorted(clusters.values(), key=lambda c: (c["cluster_id"] is None, c["cluster_label"]))
               return result

       finally:
           conn.close()
   ```

3. **Add POST endpoint for saving stock entries**:

   ```python
   @app.post("/api/supplier/stock")
   async def save_supplier_stock(
       request: SaveStockRequest,
       current_user: UserClaims = Depends(require_role(["supplier", "super_user"]))
   ):
       """Save supplier stock entries for the current week."""
       if not request.entries:
           return {"status": "ok", "message": "No entries to save"}

       conn = get_db_connection()
       try:
           with conn.cursor() as cur:
               # Get current week ending
               cur.execute("SELECT dw.get_week_ending(CURRENT_DATE)")
               week_ending = cur.fetchone()[0]

               # Upsert each entry
               for entry in request.entries:
                   cur.execute("""
                       INSERT INTO dw.supplier_stock_entry
                           (user_id, product_id, quantity_on_hand, week_ending)
                       VALUES (%s, %s, %s, %s)
                       ON CONFLICT (user_id, product_id, week_ending)
                       DO UPDATE SET
                           quantity_on_hand = EXCLUDED.quantity_on_hand,
                           updated_at = now()
                   """, (current_user.sub, entry.product_id, entry.quantity_on_hand, week_ending))

               conn.commit()

           return {
               "status": "ok",
               "message": f"Saved {len(request.entries)} entries for week ending {week_ending}",
               "week_ending": str(week_ending),
               "entries_saved": len(request.entries)
           }
       except Exception as e:
           conn.rollback()
           raise HTTPException(status_code=500, detail=str(e))
       finally:
           conn.close()
   ```

4. **Add endpoint to get current week info**:

   ```python
   @app.get("/api/supplier/current-week")
   async def get_current_week(current_user: UserClaims = Depends(require_role(["supplier", "super_user"]))):
       """Get the current week ending date for display purposes."""
       conn = get_db_connection()
       try:
           with conn.cursor() as cur:
               cur.execute("SELECT dw.get_week_ending(CURRENT_DATE)")
               week_ending = cur.fetchone()[0]
               return {
                   "week_ending": str(week_ending),
                   "week_ending_formatted": week_ending.strftime("%B %d, %Y")
               }
       finally:
           conn.close()
   ```

### Commands and Verification

Start the backend server:

```bash
uvicorn api.main:app --reload --port 8001
```

Test the endpoints (requires a valid JWT token for a supplier user):

```bash
# Get products (replace TOKEN with actual JWT)
curl -H "Authorization: Bearer TOKEN" http://localhost:8001/api/supplier/products

# Save stock entries
curl -X POST -H "Authorization: Bearer TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"entries": [{"product_id": 1, "quantity_on_hand": 100}]}' \
     http://localhost:8001/api/supplier/stock

# Get current week
curl -H "Authorization: Bearer TOKEN" http://localhost:8001/api/supplier/current-week
```

Expected responses:
- `/api/supplier/products`: Array of cluster objects, each with a `products` array
- `/api/supplier/stock`: `{"status": "ok", "message": "Saved N entries..."}`
- `/api/supplier/current-week`: `{"week_ending": "2026-01-24", "week_ending_formatted": "January 24, 2026"}`

### Completion Criteria

- Three new endpoints added to `api/main.py`
- Endpoints require `supplier` or `super_user` role
- Products are returned grouped by cluster with stock data
- Stock entries are saved with upsert behavior
- Error handling returns appropriate HTTP status codes

Upon completion: Update Progress section, commit with message "Add supplier stock API endpoints".

---

## Milestone 3: Supplier Portal Frontend

### Goal

Create the supplier-facing frontend with a stock entry page that displays products grouped by cluster and allows entering current quantity on hand. At the end of this milestone, suppliers can log in, view products by cluster, enter stock quantities, and save their entries.

### Prerequisites

- Milestone 1 complete: database schema in place
- Milestone 2 complete: API endpoints working
- At least one test supplier user created with 'supplier' role

### Context for This Milestone

**Files to create/modify**:
- `frontend/src/pages/SupplierStock.tsx` - Main stock entry page
- `frontend/src/App.tsx` - Add route and navigation for suppliers
- `frontend/src/context/AuthContext.tsx` - May need to handle supplier role

**Existing patterns to follow**:
- `Products.tsx` for table structure and styling
- `ClusterManagement.tsx` for grouped/hierarchical display
- `AuthContext` for role checking with `useRole()` hook

**Key UI requirements**:
- Grouped by Product Cluster with cluster name as header row
- Table columns: SKU Code, Title, Last Week Qty, Current Qty (editable)
- Save button with loading state and success feedback
- Responsive design for desktop and tablet

### Work

1. **Create `frontend/src/pages/SupplierStock.tsx`**:

   ```tsx
   import { useState, useEffect } from 'react';
   import { useAuth } from '../context/AuthContext';
   import { Package, Save, Loader2, CheckCircle } from 'lucide-react';

   interface Product {
     product_id: number;
     product_code: string;
     item_name: string;
     cluster_id: number | null;
     cluster_label: string | null;
     current_week_qty: number | null;
     previous_week_qty: number | null;
   }

   interface Cluster {
     cluster_id: number | null;
     cluster_label: string;
     products: Product[];
   }

   export default function SupplierStock() {
     const { session } = useAuth();
     const [clusters, setClusters] = useState<Cluster[]>([]);
     const [loading, setLoading] = useState(true);
     const [saving, setSaving] = useState(false);
     const [saveSuccess, setSaveSuccess] = useState(false);
     const [error, setError] = useState<string | null>(null);
     const [weekEnding, setWeekEnding] = useState<string>('');
     const [quantities, setQuantities] = useState<Record<number, string>>({});
     const [hasChanges, setHasChanges] = useState(false);

     useEffect(() => {
       fetchData();
     }, [session]);

     const fetchData = async () => {
       if (!session?.access_token) return;

       setLoading(true);
       setError(null);

       try {
         // Fetch products and current week info in parallel
         const [productsRes, weekRes] = await Promise.all([
           fetch('/api/supplier/products', {
             headers: { 'Authorization': `Bearer ${session.access_token}` }
           }),
           fetch('/api/supplier/current-week', {
             headers: { 'Authorization': `Bearer ${session.access_token}` }
           })
         ]);

         if (!productsRes.ok) throw new Error('Failed to fetch products');
         if (!weekRes.ok) throw new Error('Failed to fetch week info');

         const productsData = await productsRes.json();
         const weekData = await weekRes.json();

         setClusters(productsData);
         setWeekEnding(weekData.week_ending_formatted);

         // Initialize quantities from existing data
         const initialQtys: Record<number, string> = {};
         productsData.forEach((cluster: Cluster) => {
           cluster.products.forEach((product: Product) => {
             initialQtys[product.product_id] = product.current_week_qty?.toString() ?? '';
           });
         });
         setQuantities(initialQtys);
         setHasChanges(false);
       } catch (err) {
         setError(err instanceof Error ? err.message : 'An error occurred');
       } finally {
         setLoading(false);
       }
     };

     const handleQuantityChange = (productId: number, value: string) => {
       // Allow empty string or valid non-negative integers
       if (value === '' || /^\d+$/.test(value)) {
         setQuantities(prev => ({ ...prev, [productId]: value }));
         setHasChanges(true);
         setSaveSuccess(false);
       }
     };

     const handleSave = async () => {
       if (!session?.access_token) return;

       setSaving(true);
       setError(null);
       setSaveSuccess(false);

       try {
         // Build entries array from quantities that have values
         const entries = Object.entries(quantities)
           .filter(([_, qty]) => qty !== '')
           .map(([productId, qty]) => ({
             product_id: parseInt(productId),
             quantity_on_hand: parseInt(qty)
           }));

         const response = await fetch('/api/supplier/stock', {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${session.access_token}`,
             'Content-Type': 'application/json'
           },
           body: JSON.stringify({ entries })
         });

         if (!response.ok) {
           const data = await response.json();
           throw new Error(data.detail || 'Failed to save');
         }

         setSaveSuccess(true);
         setHasChanges(false);

         // Clear success message after 3 seconds
         setTimeout(() => setSaveSuccess(false), 3000);
       } catch (err) {
         setError(err instanceof Error ? err.message : 'Failed to save');
       } finally {
         setSaving(false);
       }
     };

     if (loading) {
       return (
         <div className="flex items-center justify-center h-64">
           <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
         </div>
       );
     }

     return (
       <div className="p-6 max-w-6xl mx-auto">
         {/* Header */}
         <div className="mb-6">
           <div className="flex items-center justify-between">
             <div>
               <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                 <Package className="h-6 w-6" />
                 Stock Holdings
               </h1>
               <p className="text-gray-600 mt-1">
                 Enter your current stock on hand for week ending {weekEnding}
               </p>
             </div>
             <button
               onClick={handleSave}
               disabled={saving || !hasChanges}
               className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                 saving || !hasChanges
                   ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                   : 'bg-blue-600 text-white hover:bg-blue-700'
               }`}
             >
               {saving ? (
                 <Loader2 className="h-4 w-4 animate-spin" />
               ) : saveSuccess ? (
                 <CheckCircle className="h-4 w-4" />
               ) : (
                 <Save className="h-4 w-4" />
               )}
               {saving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save All'}
             </button>
           </div>

           {error && (
             <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
               {error}
             </div>
           )}

           {saveSuccess && (
             <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
               Stock entries saved successfully!
             </div>
           )}
         </div>

         {/* Clusters and Products */}
         <div className="space-y-6">
           {clusters.map((cluster) => (
             <div key={cluster.cluster_id ?? 'unclustered'} className="bg-white rounded-lg shadow overflow-hidden">
               {/* Cluster Header */}
               <div className="bg-purple-50 px-4 py-3 border-b border-purple-100">
                 <h2 className="font-semibold text-purple-900">{cluster.cluster_label}</h2>
                 <p className="text-sm text-purple-600">{cluster.products.length} products</p>
               </div>

               {/* Products Table */}
               <table className="min-w-full">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                       SKU Code
                     </th>
                     <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                       Title
                     </th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                       Last Week
                     </th>
                     <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-40">
                       Current Qty
                     </th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-200">
                   {cluster.products.map((product) => (
                     <tr key={product.product_id} className="hover:bg-gray-50">
                       <td className="px-4 py-3">
                         <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                           {product.product_code}
                         </span>
                       </td>
                       <td className="px-4 py-3 text-sm text-gray-900">
                         {product.item_name}
                       </td>
                       <td className="px-4 py-3 text-sm text-gray-500 text-right">
                         {product.previous_week_qty !== null ? product.previous_week_qty.toLocaleString() : '—'}
                       </td>
                       <td className="px-4 py-3 text-right">
                         <input
                           type="text"
                           inputMode="numeric"
                           pattern="[0-9]*"
                           value={quantities[product.product_id] ?? ''}
                           onChange={(e) => handleQuantityChange(product.product_id, e.target.value)}
                           placeholder="0"
                           className="w-24 px-3 py-1.5 text-right border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                         />
                       </td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
           ))}
         </div>
       </div>
     );
   }
   ```

2. **Update `frontend/src/App.tsx`** to add the supplier route:

   Add the import at the top with other page imports:
   ```tsx
   import SupplierStock from './pages/SupplierStock';
   ```

   Inside the `Router` component, add a new route for suppliers. Find the section with `ProtectedRoute` and add:
   ```tsx
   <Route path="/supplier/stock" element={
     <ProtectedRoute>
       <SupplierStock />
     </ProtectedRoute>
   } />
   ```

3. **Update navigation for supplier role**. In the sidebar/navigation component (likely in `App.tsx` or a `Layout` component), add conditional navigation items for suppliers:

   Look for where navigation items are defined and add logic to show supplier-specific navigation when `userRole === 'supplier'`:

   ```tsx
   // In the navigation section, add conditional rendering:
   {userRole === 'supplier' ? (
     // Supplier navigation
     <>
       <NavItem to="/supplier/stock" icon={Package} label="Stock Holdings" />
       {/* Add other supplier pages here as they are created */}
     </>
   ) : (
     // Existing internal user navigation
     // ... existing nav items
   )}
   ```

4. **Handle supplier redirect after login**. In the login flow (likely in `Login.tsx` or `AuthContext`), redirect suppliers to `/supplier/stock` instead of the default dashboard:

   ```tsx
   // After successful login, check role and redirect appropriately
   const redirectPath = userRole === 'supplier' ? '/supplier/stock' : '/';
   navigate(redirectPath);
   ```

### Commands and Verification

Start the frontend development server:

```bash
cd frontend && npm run dev
```

Test the supplier flow:

1. Create a test supplier user:
   - In Supabase dashboard, create a new user with email/password
   - Insert into `dw.user_roles`: `INSERT INTO dw.user_roles (user_id, role_id) VALUES ('<user-uuid>', 'supplier')`

2. Log in as the supplier user at `http://localhost:5173/login`

3. Verify the stock entry page:
   - Products are grouped by cluster with cluster name as header
   - Table shows SKU Code, Title, Last Week Qty, Current Qty
   - Current Qty is an editable text input
   - Last Week shows "—" for products without previous entries
   - Save button is disabled until changes are made
   - After saving, success message appears
   - Refreshing the page shows saved quantities

4. Verify access control:
   - Supplier cannot access internal pages (should redirect or show error)
   - Internal users with `super_user` role can access `/supplier/stock` for testing

### Completion Criteria

- `SupplierStock.tsx` page created and functional
- Route added to `App.tsx`
- Navigation shows appropriate items based on user role
- Products display grouped by cluster with correct columns
- Quantity inputs accept only non-negative integers
- Save functionality works with success feedback
- Page is responsive on desktop and tablet
- Suppliers are redirected to stock page after login

Upon completion: Update Progress section, commit with message "Add supplier stock entry portal frontend".

---

## Interfaces and Dependencies

### Database Objects Created

**Tables**:
- `dw.supplier_stock_entry` - Stores weekly stock entries per supplier per product

**Functions**:
- `dw.get_week_ending(date)` - Returns Saturday of the given week
- `public.get_products_for_supplier_stock()` - Returns products with cluster info
- `public.get_supplier_stock_entries(uuid)` - Returns current and previous week entries
- `public.save_supplier_stock_entries(jsonb)` - Upserts stock entries

**Roles**:
- `supplier` added to `dw.app_roles`

### API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/supplier/products` | supplier, super_user | Products grouped by cluster with stock data |
| POST | `/api/supplier/stock` | supplier, super_user | Save stock entries |
| GET | `/api/supplier/current-week` | supplier, super_user | Current week ending date |

### Frontend Components

- `SupplierStock.tsx` - Main stock entry page
- Route: `/supplier/stock`

### Type Definitions

```typescript
interface Product {
  product_id: number;
  product_code: string;
  item_name: string;
  cluster_id: number | null;
  cluster_label: string | null;
  current_week_qty: number | null;
  previous_week_qty: number | null;
}

interface Cluster {
  cluster_id: number | null;
  cluster_label: string;
  products: Product[];
}
```

## Idempotence and Recovery

**Database migration**: Uses `ON CONFLICT DO NOTHING` for role insertion, safe to run multiple times.

**Stock entry saves**: Uses upsert pattern (`ON CONFLICT DO UPDATE`), so repeated saves with same data are safe.

**Frontend state**: Initializes from server data on load, so refreshing recovers from any client-side issues.

**Partial saves**: Each entry is saved individually in a transaction, so partial failures leave valid data.

## Artifacts and Notes

### Example API Response for Products

```json
[
  {
    "cluster_id": 1,
    "cluster_label": "Beverages",
    "products": [
      {
        "product_id": 101,
        "product_code": "BEV-001",
        "item_name": "Sparkling Water 500ml",
        "cluster_id": 1,
        "cluster_label": "Beverages",
        "current_week_qty": null,
        "previous_week_qty": 250
      }
    ]
  },
  {
    "cluster_id": null,
    "cluster_label": "Unclustered",
    "products": [...]
  }
]
```

### Week Ending Calculation

The system uses Saturday as the week-ending date:
- Monday 2026-01-20 → Saturday 2026-01-24
- Sunday 2026-01-19 → Saturday 2026-01-24
- Saturday 2026-01-24 → Saturday 2026-01-24

This ensures consistent weekly buckets regardless of when the supplier enters data.
