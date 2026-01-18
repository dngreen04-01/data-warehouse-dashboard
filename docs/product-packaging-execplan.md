# Add Product Packaging Information

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with PLANS.md at docs/Plans.md.

## Purpose / Big Picture

After this change, users can record packaging specifications for each product in the data warehouse. When viewing the Products page and clicking the edit button on any product, a modal form appears where they can enter:

- **Carton dimensions**: width, height, and depth in millimeters
- **Carton weight**: in kilograms
- **Cartons per pallet**: integer count
- **Product group**: the existing editable field

This packaging data supports production planning, logistics optimization, and shipping calculations. To verify the feature works, a user can edit any product from the Products page, enter packaging dimensions, save, and see the data persisted when they return to edit that product again.

## Progress

- [x] Milestone 1: Database schema changes (add packaging columns)
- [x] Milestone 2: Update RPC function and TypeScript types
- [x] Milestone 3: Create edit modal component and integrate into Products page

## Surprises & Discoveries

(To be populated during implementation.)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-19 | Use modal instead of inline editing | Packaging has 5 fields plus product group—too many for inline editing. A modal provides better UX and allows validation before save. |
| 2026-01-19 | Store dimensions as integers (mm) | Millimeters provide sufficient precision without decimals. Simpler storage and display. |
| 2026-01-19 | All packaging fields nullable | Products may not have packaging info defined. Optional fields with null default is appropriate. |

## Outcomes & Retrospective

**Milestone 3 Completed** (2026-01-19):
- Replaced inline product group editor with full modal dialog
- Modal includes all 6 editable fields: product group + 5 packaging fields
- Form state management with string-based inputs for numeric fields (allows empty = null)
- Save function parses numeric values and uses COALESCE pattern via RPC
- TypeScript build passes with no errors
- Removed unused imports (X, Check icons) that were for inline editing

## Context and Orientation

The data warehouse uses Supabase with PostgreSQL. All warehouse tables live in the `dw` schema (not public). The frontend is React with TypeScript, using Supabase JS client with `.schema('dw')` for queries.

**Key files:**

- `supabase/migrations/` — Database migration files (numbered by date)
- `supabase/schema.sql` — Full schema definition (reference only, not edited directly)
- `api/main.py` — FastAPI backend (not needed for this feature—we use RPC)
- `frontend/src/pages/Products.tsx` — Products list page with existing edit functionality
- `frontend/src/lib/supabase.ts` — Supabase client configuration

**Current product editing flow:**

1. User clicks pencil icon on a product row in the Products table
2. Inline dropdown appears showing product groups
3. User selects a group and clicks checkmark to save (or X to cancel)
4. Calls RPC `update_product(p_product_id, p_product_group)` to persist

**RPC function location:** Defined in migration `20251212_cluster_separation.sql`. The function accepts `bigint` product ID and optional `text` product group.

**Product interface in Products.tsx:**
```typescript
interface Product {
    product_id: number;
    product_code: string;
    item_name: string;
    item_description: string;
    product_group: string;
    price: number;
    purchase_unit_price: number | null;
    quantity_on_hand: number | null;
    is_tracked_as_inventory: boolean;
    archived: boolean;
    cluster_id: number | null;
    cluster_label: string | null;
}
```

---

## Milestone 1: Database Schema Changes

### Goal

Add five new nullable columns to `dw.dim_product` for packaging information. After this milestone, the database can store carton dimensions, weight, and palletization data for any product.

### Prerequisites

- Access to run Supabase migrations
- No blocking migrations in progress

### Context for This Milestone

The `dw.dim_product` table is defined in `supabase/schema.sql` and modified via numbered migration files in `supabase/migrations/`. Each migration file is named with a date prefix (e.g., `20260119_...`).

Current relevant columns include `product_id` (bigint PK), `product_code`, `item_name`, `product_group`, and various inventory fields. We need to add:

| Column | Type | Description |
|--------|------|-------------|
| `carton_width_mm` | integer | Carton width in millimeters |
| `carton_height_mm` | integer | Carton height in millimeters |
| `carton_depth_mm` | integer | Carton depth in millimeters |
| `carton_weight_kg` | numeric(8,3) | Carton weight in kilograms (3 decimal places for grams precision) |
| `cartons_per_pallet` | integer | Number of cartons that fit on a standard pallet |

All columns are nullable with no default value.

### Work

Create a new migration file `supabase/migrations/20260119_product_packaging.sql` with the following content:

```sql
-- Add packaging information columns to dim_product
-- These fields capture carton dimensions for shipping/logistics planning

ALTER TABLE dw.dim_product
ADD COLUMN carton_width_mm integer,
ADD COLUMN carton_height_mm integer,
ADD COLUMN carton_depth_mm integer,
ADD COLUMN carton_weight_kg numeric(8, 3),
ADD COLUMN cartons_per_pallet integer;

-- Add comments for documentation
COMMENT ON COLUMN dw.dim_product.carton_width_mm IS 'Carton width in millimeters';
COMMENT ON COLUMN dw.dim_product.carton_height_mm IS 'Carton height in millimeters';
COMMENT ON COLUMN dw.dim_product.carton_depth_mm IS 'Carton depth in millimeters';
COMMENT ON COLUMN dw.dim_product.carton_weight_kg IS 'Carton weight in kilograms';
COMMENT ON COLUMN dw.dim_product.cartons_per_pallet IS 'Number of cartons per pallet';
```

### Commands and Verification

From the project root directory, apply the migration to the local/development database:

```bash
supabase db push
```

Or if using direct psql:

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260119_product_packaging.sql
```

Verify the columns exist:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'dw' AND table_name = 'dim_product'
AND column_name IN ('carton_width_mm', 'carton_height_mm', 'carton_depth_mm', 'carton_weight_kg', 'cartons_per_pallet');
```

Expected output: 5 rows, all nullable, with appropriate types (integer for dimensions/pallet count, numeric for weight).

### Completion Criteria

- Migration file exists at `supabase/migrations/20260119_product_packaging.sql`
- Running the migration succeeds without errors
- All 5 columns appear in `dw.dim_product` with correct types
- Update Progress section: mark Milestone 1 complete
- Commit with message: "Add packaging columns to dim_product schema"

---

## Milestone 2: Update RPC Function and TypeScript Types

### Goal

Extend the `update_product` RPC function to accept packaging fields, and update the TypeScript Product interface to include these fields. After this milestone, the frontend can call the RPC with packaging data, and the Product type reflects all new fields.

### Prerequisites

- Milestone 1 complete (packaging columns exist in database)
- Verify columns exist: run the verification query from Milestone 1

### Context for This Milestone

The existing `update_product` function is defined in `supabase/migrations/20251212_cluster_separation.sql` with this signature:

```sql
CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL
)
RETURNS void
```

It uses `COALESCE(p_product_group, product_group)` to only update the field if provided (null means "keep existing value"). We will extend this pattern to all packaging fields.

The Product interface in `frontend/src/pages/Products.tsx` needs the new fields added for type safety.

### Work

**Step 1: Create migration to update the RPC function**

Create file `supabase/migrations/20260119_update_product_packaging_rpc.sql`:

```sql
-- Extend update_product RPC to handle packaging fields
-- Each field uses COALESCE pattern: null = keep existing, non-null = update

CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL,
    p_carton_width_mm integer DEFAULT NULL,
    p_carton_height_mm integer DEFAULT NULL,
    p_carton_depth_mm integer DEFAULT NULL,
    p_carton_weight_kg numeric DEFAULT NULL,
    p_cartons_per_pallet integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE dw.dim_product
    SET
        product_group = COALESCE(p_product_group, product_group),
        carton_width_mm = COALESCE(p_carton_width_mm, carton_width_mm),
        carton_height_mm = COALESCE(p_carton_height_mm, carton_height_mm),
        carton_depth_mm = COALESCE(p_carton_depth_mm, carton_depth_mm),
        carton_weight_kg = COALESCE(p_carton_weight_kg, carton_weight_kg),
        cartons_per_pallet = COALESCE(p_cartons_per_pallet, cartons_per_pallet),
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id;
END;
$$;

-- Ensure authenticated users can call this function
GRANT EXECUTE ON FUNCTION public.update_product(bigint, text, integer, integer, integer, numeric, integer) TO authenticated;
```

**Step 2: Update TypeScript Product interface**

In `frontend/src/pages/Products.tsx`, update the Product interface (around line 10-23):

```typescript
interface Product {
    product_id: number;
    product_code: string;
    item_name: string;
    item_description: string;
    product_group: string;
    price: number;
    purchase_unit_price: number | null;
    quantity_on_hand: number | null;
    is_tracked_as_inventory: boolean;
    archived: boolean;
    cluster_id: number | null;
    cluster_label: string | null;
    // Packaging fields
    carton_width_mm: number | null;
    carton_height_mm: number | null;
    carton_depth_mm: number | null;
    carton_weight_kg: number | null;
    cartons_per_pallet: number | null;
}
```

**Step 3: Update the Supabase query to fetch packaging fields**

In `frontend/src/pages/Products.tsx`, the `fetchProducts` function queries `dim_product`. The select statement (around line 56-73) needs to include the new fields. Update the select to add them:

```typescript
.select(`
    product_id,
    product_code,
    item_name,
    item_description,
    product_group,
    price,
    purchase_unit_price,
    quantity_on_hand,
    is_tracked_as_inventory,
    archived,
    carton_width_mm,
    carton_height_mm,
    carton_depth_mm,
    carton_weight_kg,
    cartons_per_pallet,
    dim_product_cluster (
        cluster_id,
        dim_cluster (
            cluster_id,
            cluster_label
        )
    )
`)
```

Also update the mapped product object (around line 96-109) to include the new fields:

```typescript
const mappedProducts = (data || []).map((p: any) => ({
    product_id: p.product_id,
    product_code: p.product_code,
    item_name: p.item_name,
    item_description: p.item_description,
    product_group: p.product_group,
    price: p.price,
    purchase_unit_price: p.purchase_unit_price,
    quantity_on_hand: p.quantity_on_hand,
    is_tracked_as_inventory: p.is_tracked_as_inventory,
    archived: p.archived,
    cluster_id: p.dim_product_cluster?.dim_cluster?.cluster_id ?? null,
    cluster_label: p.dim_product_cluster?.dim_cluster?.cluster_label ?? null,
    carton_width_mm: p.carton_width_mm ?? null,
    carton_height_mm: p.carton_height_mm ?? null,
    carton_depth_mm: p.carton_depth_mm ?? null,
    carton_weight_kg: p.carton_weight_kg ?? null,
    cartons_per_pallet: p.cartons_per_pallet ?? null,
}));
```

And update the fallback mapping (around line 89-93) similarly.

### Commands and Verification

Apply the RPC migration:

```bash
supabase db push
```

Verify the function signature:

```sql
SELECT pg_get_function_arguments(oid)
FROM pg_proc
WHERE proname = 'update_product';
```

Expected: Shows all 7 parameters including the new packaging fields.

Start the frontend dev server and verify no TypeScript errors:

```bash
cd frontend && npm run dev
```

Open browser console on Products page—should load without errors.

### Completion Criteria

- Migration file exists at `supabase/migrations/20260119_update_product_packaging_rpc.sql`
- RPC function updated with 7 parameters
- Product interface includes 5 new packaging fields
- Products page loads without TypeScript or runtime errors
- Update Progress section: mark Milestone 2 complete
- Commit with message: "Add packaging fields to update_product RPC and Product type"

---

## Milestone 3: Create Edit Modal and Integrate into Products Page

### Goal

Replace the inline product group editor with a modal dialog that allows editing both product group and all packaging fields. After this milestone, clicking the edit (pencil) button opens a modal with form fields for all editable product properties.

### Prerequisites

- Milestone 2 complete (RPC accepts packaging fields, types updated)
- Products page loads without errors with the updated Product type

### Context for This Milestone

The current edit flow in `frontend/src/pages/Products.tsx`:
- State: `editingProductId`, `editingProductGroup`, `saving`
- `startEditing(product)` sets the editing state
- Inline dropdown renders when `editingProductId === product.product_id`
- `saveProductGroup(productId)` calls RPC and updates local state

We will:
1. Add state for all editable fields (product group + 5 packaging fields)
2. Create a modal component that appears when editing
3. Update the save function to pass all fields to the RPC
4. Update local state on successful save

The modal will use the existing Tailwind styling patterns from the codebase.

### Work

**Step 1: Add edit state for packaging fields**

In `frontend/src/pages/Products.tsx`, after the existing edit state declarations (around line 39-42), update to handle all fields:

```typescript
// Edit state - tracks the product being edited and form values
const [editingProduct, setEditingProduct] = useState<Product | null>(null);
const [editForm, setEditForm] = useState({
    product_group: '',
    carton_width_mm: '',
    carton_height_mm: '',
    carton_depth_mm: '',
    carton_weight_kg: '',
    cartons_per_pallet: '',
});
const [saving, setSaving] = useState(false);
```

Remove the old `editingProductId` and `editingProductGroup` state variables.

**Step 2: Update startEditing and cancelEditing functions**

Replace the existing functions (around line 206-214):

```typescript
const startEditing = (product: Product) => {
    setEditingProduct(product);
    setEditForm({
        product_group: product.product_group || '',
        carton_width_mm: product.carton_width_mm?.toString() || '',
        carton_height_mm: product.carton_height_mm?.toString() || '',
        carton_depth_mm: product.carton_depth_mm?.toString() || '',
        carton_weight_kg: product.carton_weight_kg?.toString() || '',
        cartons_per_pallet: product.cartons_per_pallet?.toString() || '',
    });
};

const cancelEditing = () => {
    setEditingProduct(null);
    setEditForm({
        product_group: '',
        carton_width_mm: '',
        carton_height_mm: '',
        carton_depth_mm: '',
        carton_weight_kg: '',
        cartons_per_pallet: '',
    });
};
```

**Step 3: Update the save function**

Replace `saveProductGroup` (around line 216-239) with `saveProduct`:

```typescript
const saveProduct = async () => {
    if (!editingProduct) return;

    setSaving(true);
    try {
        // Parse numeric fields - empty string becomes null (keep existing)
        const parseIntOrNull = (val: string) => val ? parseInt(val, 10) : null;
        const parseFloatOrNull = (val: string) => val ? parseFloat(val) : null;

        const { error } = await supabase.rpc('update_product', {
            p_product_id: editingProduct.product_id,
            p_product_group: editForm.product_group || null,
            p_carton_width_mm: parseIntOrNull(editForm.carton_width_mm),
            p_carton_height_mm: parseIntOrNull(editForm.carton_height_mm),
            p_carton_depth_mm: parseIntOrNull(editForm.carton_depth_mm),
            p_carton_weight_kg: parseFloatOrNull(editForm.carton_weight_kg),
            p_cartons_per_pallet: parseIntOrNull(editForm.cartons_per_pallet),
        });
        if (error) throw error;

        // Update local state
        setProducts(prev => prev.map(p =>
            p.product_id === editingProduct.product_id
                ? {
                    ...p,
                    product_group: editForm.product_group || p.product_group,
                    carton_width_mm: parseIntOrNull(editForm.carton_width_mm) ?? p.carton_width_mm,
                    carton_height_mm: parseIntOrNull(editForm.carton_height_mm) ?? p.carton_height_mm,
                    carton_depth_mm: parseIntOrNull(editForm.carton_depth_mm) ?? p.carton_depth_mm,
                    carton_weight_kg: parseFloatOrNull(editForm.carton_weight_kg) ?? p.carton_weight_kg,
                    cartons_per_pallet: parseIntOrNull(editForm.cartons_per_pallet) ?? p.cartons_per_pallet,
                }
                : p
        ));
        cancelEditing();
        fetchProductGroups(); // Refresh dropdown options if new group was entered
    } catch (error) {
        console.error('Error updating product:', error);
        alert('Failed to update product. Please try again.');
    } finally {
        setSaving(false);
    }
};
```

**Step 4: Create the edit modal component**

Add this modal JSX just before the closing `</div>` of the main return statement (before line 549). This renders when `editingProduct` is set:

```tsx
{/* Edit Product Modal */}
{editingProduct && (
    <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black/50 transition-opacity"
                onClick={cancelEditing}
            />

            {/* Modal */}
            <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
                <div className="mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">Edit Product</h2>
                    <p className="text-sm text-gray-500">{editingProduct.item_name}</p>
                    <p className="text-xs text-gray-400 font-mono">{editingProduct.product_code}</p>
                </div>

                <div className="space-y-4">
                    {/* Product Group */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Product Group
                        </label>
                        <select
                            value={editForm.product_group}
                            onChange={(e) => setEditForm(prev => ({ ...prev, product_group: e.target.value }))}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="">No Group</option>
                            {productGroups.map(g => (
                                <option key={g} value={g}>{g}</option>
                            ))}
                        </select>
                    </div>

                    {/* Packaging Section Header */}
                    <div className="border-t pt-4">
                        <h3 className="text-sm font-medium text-gray-900 mb-3">Carton Packaging</h3>
                    </div>

                    {/* Carton Dimensions */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Width (mm)
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={editForm.carton_width_mm}
                                onChange={(e) => setEditForm(prev => ({ ...prev, carton_width_mm: e.target.value }))}
                                placeholder="—"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Height (mm)
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={editForm.carton_height_mm}
                                onChange={(e) => setEditForm(prev => ({ ...prev, carton_height_mm: e.target.value }))}
                                placeholder="—"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Depth (mm)
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={editForm.carton_depth_mm}
                                onChange={(e) => setEditForm(prev => ({ ...prev, carton_depth_mm: e.target.value }))}
                                placeholder="—"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>

                    {/* Weight and Palletization */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Carton Weight (kg)
                            </label>
                            <input
                                type="number"
                                min="0"
                                step="0.001"
                                value={editForm.carton_weight_kg}
                                onChange={(e) => setEditForm(prev => ({ ...prev, carton_weight_kg: e.target.value }))}
                                placeholder="—"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Cartons per Pallet
                            </label>
                            <input
                                type="number"
                                min="0"
                                value={editForm.cartons_per_pallet}
                                onChange={(e) => setEditForm(prev => ({ ...prev, cartons_per_pallet: e.target.value }))}
                                placeholder="—"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={cancelEditing}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={saveProduct}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    </div>
)}
```

**Step 5: Update the table row edit button and remove inline editing**

In the table body, find the Group column cell (around line 456-493) and replace the conditional inline editing with just the display:

```tsx
<td className="whitespace-nowrap px-6 py-4">
    {product.product_group ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
            <Layers className="h-3 w-3" />
            {product.product_group}
        </span>
    ) : (
        <span className="text-sm text-gray-400">-</span>
    )}
</td>
```

Update the Actions column (around line 530-540) to always show the edit button:

```tsx
<td className="whitespace-nowrap px-6 py-4 text-right">
    <button
        onClick={() => startEditing(product)}
        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
        title="Edit product"
    >
        <Pencil className="h-4 w-4" />
    </button>
</td>
```

### Commands and Verification

Start the frontend development server:

```bash
cd frontend && npm run dev
```

Test the feature:

1. Navigate to the Products page
2. Click the pencil icon on any product row
3. Modal should appear with the product name and code displayed
4. Product group dropdown should show current value (or "No Group")
5. Packaging fields should be empty or show existing values
6. Enter test values: Width=400, Height=300, Depth=250, Weight=5.5, Cartons=48
7. Click "Save Changes"
8. Modal should close, no errors in console
9. Click edit on the same product—values should persist

Verify data in database:

```sql
SELECT product_code, item_name, carton_width_mm, carton_height_mm, carton_depth_mm,
       carton_weight_kg, cartons_per_pallet
FROM dw.dim_product
WHERE carton_width_mm IS NOT NULL
LIMIT 5;
```

### Completion Criteria

- Edit button opens modal instead of inline editor
- Modal displays product name and code
- All 6 fields (product group + 5 packaging) are editable
- Save persists all fields to database via RPC
- Cancel closes modal without saving
- Clicking backdrop closes modal
- No TypeScript errors, no console errors
- Update Progress section: mark Milestone 3 complete
- Commit with message: "Add product edit modal with packaging fields"

---

## Interfaces and Dependencies

**Database:**
- Table: `dw.dim_product` with 5 new columns
- RPC: `public.update_product(bigint, text, integer, integer, integer, numeric, integer)`

**Frontend:**
- React 18+ with TypeScript
- Supabase JS client (already configured)
- Tailwind CSS for styling
- Lucide React for icons (already imported)

**No new dependencies required.**

## Idempotence and Recovery

All migrations use `ALTER TABLE ADD COLUMN` which is safe to re-run (will error if column exists, but won't corrupt data). The RPC uses `CREATE OR REPLACE FUNCTION` which is idempotent.

If a migration fails partway:
1. Check which columns exist: query `information_schema.columns`
2. Manually add missing columns or drop and re-run migration
3. The RPC migration can be re-run safely anytime

Frontend changes are additive—the modal is new UI that doesn't break existing functionality if partially applied.

## Artifacts and Notes

**Expected modal appearance:**

```
┌─────────────────────────────────────────┐
│ Edit Product                            │
│ Honey 500g Jar                          │
│ HON-500                                 │
├─────────────────────────────────────────┤
│ Product Group                           │
│ [Honey Products        ▼]               │
├─────────────────────────────────────────┤
│ Carton Packaging                        │
│                                         │
│ Width (mm)  Height (mm)  Depth (mm)     │
│ [  400  ]   [  300  ]    [  250  ]      │
│                                         │
│ Carton Weight (kg)  Cartons per Pallet  │
│ [    5.500    ]     [      48      ]    │
│                                         │
│                    [Cancel] [Save]      │
└─────────────────────────────────────────┘
```
