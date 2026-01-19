# Add Price List PDF Export Feature

This ExecPlan is a living document. The sections Progress, Surprises & Discoveries, Decision Log, and Outcomes & Retrospective must be kept up to date as work proceeds.

Reference: This document is maintained in accordance with PLANS.md at `docs/Plans.md`.


## Purpose / Big Picture

After this change, users can export a professional PDF price list directly from the Products page. The PDF matches the Akina Trading Ltd branding format: Klipon logo in the header, company contact details, and a table showing each product with its unit price and bulk price (for orders of 10+ cartons). Users can choose whether to display Xero-synced prices or custom price list prices. This enables the business to quickly generate customer-facing price sheets without manual document creation.

To see it working: navigate to the Products page, click "Export Price List", select a price source, and download the PDF. Open the PDF to verify it shows the Klipon logo, company details, effective date, and a properly formatted product/price table.


## Progress

- [x] Milestone 1: Database schema changes (add price_list_price and bulk_price columns, update RPC)
- [ ] Milestone 2: Backend PDF generation (create PriceListPDF class and API endpoint)
- [ ] Milestone 3: Frontend integration (export button, modal, edit fields for pricing)


## Surprises & Discoveries

(To be populated during implementation.)


## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-19 | Use per-product bulk_price field instead of percentage discount | User requirement: different products may have different bulk pricing strategies |
| 2026-01-19 | Support both Xero prices and custom price_list_price | Flexibility: sometimes Xero prices differ from what appears on customer-facing lists |
| 2026-01-19 | PDF-only export (no CSV/Excel) | User requirement: professional customer-facing documents are the priority |
| 2026-01-19 | Include all non-archived products by default | User requirement: simplest workflow for generating complete price lists |
| 2026-01-19 | Store logo as PNG in scripts/assets/ | FPDF library does not support SVG; PNG is the standard image format for FPDF |


## Outcomes & Retrospective

(To be populated during and after implementation.)


## Context and Orientation

This repository is a data warehouse application with a React/TypeScript frontend and Python/FastAPI backend, using Supabase (PostgreSQL) as the database. The key architectural points relevant to this feature:

**Database Schema**: All data warehouse tables live in the `dw` schema (not public). The product dimension table is `dw.dim_product`. When querying from the backend, use fully-qualified names like `dw.dim_product`. When querying from the frontend Supabase client, use `.schema('dw')` before `.from('dim_product')`.

**Existing Product Fields** (in `dw.dim_product`):
- `product_id` (bigint, primary key)
- `product_code` (text) - SKU/item code
- `item_name` (text) - product display name
- `price` (numeric 18,2) - selling price synced from Xero
- `purchase_unit_price` (numeric 18,4) - cost price
- `archived` (boolean) - soft delete flag
- `is_tracked_as_inventory` (boolean)
- Packaging fields: `carton_width_mm`, `carton_height_mm`, `carton_depth_mm`, `carton_weight_kg`, `cartons_per_pallet`

**Existing PDF Generation**: The file `scripts/generate_statement_pdf.py` generates merchant statements using the FPDF library. It defines a `StatementPDF` class that extends `FPDF` with custom `header()` and `footer()` methods. The API exposes this at `GET /api/statement/{merchant_group}/pdf` in `api/main.py`, returning a `StreamingResponse` with `media_type="application/pdf"`.

**Existing RPC Pattern**: Product updates use an RPC function `public.update_product()` defined in `supabase/migrations/20260119_update_product_packaging_rpc.sql`. It accepts nullable parameters and uses COALESCE to only update non-null values. The frontend calls this via `supabase.rpc('update_product', {...})`.

**Frontend Structure**: The Products page is at `frontend/src/pages/Products.tsx`. It fetches products from `dw.dim_product`, displays them in a table, and has an edit modal for updating product details. The modal uses local state (`editForm`) and calls the RPC on save.

**Company Details for PDF**:
- Company: Akina Trading Ltd
- Email: admin@klipon.co.nz
- Address: 44 Tukorako Dr, Mt Maunganui, NZ


## Milestone 1: Database Schema Changes

### Goal

At the end of this milestone, the `dw.dim_product` table has two new columns (`price_list_price` and `bulk_price`) and the `update_product` RPC function can update these fields. No frontend or backend code changes yet—just the database layer.

### Prerequisites

The database must be accessible via the Supabase CLI or direct connection. The existing `dw.dim_product` table must exist with the current schema. The `public.update_product` function must exist (from migration `20260119_update_product_packaging_rpc.sql`).

### Context for This Milestone

The `dw.dim_product` table currently has a `price` field (synced from Xero) but no way to store a custom price list price or bulk discount price. We need to add:

1. `price_list_price` (numeric 18,2) - optional override price for customer-facing price lists
2. `bulk_price` (numeric 18,2) - price for bulk orders (10+ cartons)

The existing RPC function signature is:

```sql
CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL,
    p_carton_width_mm integer DEFAULT NULL,
    p_carton_height_mm integer DEFAULT NULL,
    p_carton_depth_mm integer DEFAULT NULL,
    p_carton_weight_kg numeric DEFAULT NULL,
    p_cartons_per_pallet integer DEFAULT NULL
)
```

We must extend it with two new parameters while preserving backward compatibility.

### Work

Create a new migration file at `supabase/migrations/20260120_price_list_fields.sql`. This file will:

1. Add the two new columns to `dw.dim_product` using ALTER TABLE statements. Both columns are nullable numeric(18,2) to match the existing `price` column format.

2. Replace the `update_product` function with an extended version that includes the new parameters. The function body uses COALESCE so passing NULL for any parameter leaves the existing value unchanged.

3. Grant execute permission on the new function signature to the `authenticated` role.

The complete migration content:

```sql
-- Add price list fields to dim_product
ALTER TABLE dw.dim_product
ADD COLUMN IF NOT EXISTS price_list_price numeric(18,2),
ADD COLUMN IF NOT EXISTS bulk_price numeric(18,2);

COMMENT ON COLUMN dw.dim_product.price_list_price IS 'Optional custom price for price list exports (overrides Xero price)';
COMMENT ON COLUMN dw.dim_product.bulk_price IS 'Bulk order price for 10+ cartons';

-- Extend update_product RPC to handle new fields
CREATE OR REPLACE FUNCTION public.update_product(
    p_product_id bigint,
    p_product_group text DEFAULT NULL,
    p_carton_width_mm integer DEFAULT NULL,
    p_carton_height_mm integer DEFAULT NULL,
    p_carton_depth_mm integer DEFAULT NULL,
    p_carton_weight_kg numeric DEFAULT NULL,
    p_cartons_per_pallet integer DEFAULT NULL,
    p_price_list_price numeric DEFAULT NULL,
    p_bulk_price numeric DEFAULT NULL
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
        price_list_price = COALESCE(p_price_list_price, price_list_price),
        bulk_price = COALESCE(p_bulk_price, bulk_price),
        updated_at = timezone('utc', now())
    WHERE product_id = p_product_id;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.update_product(bigint, text, integer, integer, integer, numeric, integer, numeric, numeric) TO authenticated;
```

### Commands and Verification

From the repository root, apply the migration:

    cd /Users/damiengreen/Desktop/Data\ Warehouse
    supabase db push

Alternatively, if using direct connection:

    psql "$SUPABASE_CONNECTION_STRING" -f supabase/migrations/20260120_price_list_fields.sql

Verify the columns exist:

    psql "$SUPABASE_CONNECTION_STRING" -c "\d dw.dim_product" | grep -E "price_list_price|bulk_price"

Expected output shows both columns:

    price_list_price    | numeric(18,2)    |           |          |
    bulk_price          | numeric(18,2)    |           |          |

Verify the RPC function accepts the new parameters:

    psql "$SUPABASE_CONNECTION_STRING" -c "SELECT proname, pronargs FROM pg_proc WHERE proname = 'update_product';"

Expected: shows `update_product` with `9` arguments.

Test the RPC by updating a product (use any valid product_id):

    psql "$SUPABASE_CONNECTION_STRING" -c "SELECT public.update_product(1, NULL, NULL, NULL, NULL, NULL, NULL, 99.99, 89.99);"

Then verify:

    psql "$SUPABASE_CONNECTION_STRING" -c "SELECT product_id, price_list_price, bulk_price FROM dw.dim_product WHERE product_id = 1;"

Expected: shows the updated price values.

### Completion Criteria

The milestone is complete when: (1) both columns exist in `dw.dim_product`, (2) the RPC function accepts 9 parameters, and (3) calling the RPC successfully updates the new fields. Update the Progress section to mark Milestone 1 complete, commit the migration file with message "Add price list and bulk price fields to dim_product", and stop.


## Milestone 2: Backend PDF Generation

### Goal

At the end of this milestone, a new API endpoint `GET /api/price-list/pdf` exists and returns a downloadable PDF. The PDF displays the Klipon logo, company details, effective date, and a table of products with unit prices and bulk prices. The PDF matches the format shown in the Akina Trading Ltd example.

### Prerequisites

Milestone 1 must be complete: `dw.dim_product` has `price_list_price` and `bulk_price` columns. The FastAPI backend must be runnable (`uvicorn api.main:app --reload --port 8001`). The FPDF library must be installed (it already is, per `requirements.txt`).

### Context for This Milestone

The existing `scripts/generate_statement_pdf.py` provides a pattern to follow. It defines a class `StatementPDF(FPDF)` with custom `header()` and `footer()` methods. The API in `api/main.py` imports this, generates PDF bytes, and returns them via `StreamingResponse`.

The Klipon logo is provided as an SVG file. FPDF does not support SVG, so we must convert it to PNG. The logo should be placed at `scripts/assets/klipon-logo.png`. The image can be created by opening the SVG in a browser and exporting as PNG, or using a tool like `cairosvg` or Inkscape.

The PDF layout (matching the example):
- Header: Klipon logo (left), company name and contact (right)
- Title: "Pricing Effective [date]" in red, left-aligned
- Table: Product | Unit Price | Bulk Price (+10 carton)
- Table rows: alternating white background, prices right-aligned

Company details:
- AKINA TRADING LTD
- admin@klipon.co.nz
- 44 Tukorako Dr, Mt Maunganui, NZ

### Work

First, create the logo asset. Create the directory `scripts/assets/` if it doesn't exist. Convert the provided SVG to PNG at approximately 200x100 pixels and save as `scripts/assets/klipon-logo.png`. If programmatic conversion is needed, use:

```python
# One-time conversion script (not part of the application)
from cairosvg import svg2png
svg2png(url='path/to/Klipon logo.svg', write_to='scripts/assets/klipon-logo.png', output_width=200)
```

Next, create `scripts/generate_price_list_pdf.py` with the following structure:

```python
"""
PDF Price List Generator for Product Catalog

Generates a branded price list matching the Akina Trading Ltd format:
- Klipon logo header with company contact details
- Effective date
- Product table with unit and bulk prices
"""

import io
import os
from datetime import datetime
from decimal import Decimal
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fpdf import FPDF


COMPANY_NAME = "AKINA TRADING LTD"
COMPANY_EMAIL = "admin@klipon.co.nz"
COMPANY_ADDRESS = "44 Tukorako Dr, Mt Maunganui, NZ"
LOGO_PATH = Path(__file__).parent / "assets" / "klipon-logo.png"


class PriceListPDF(FPDF):
    """Custom PDF class for price list generation."""

    def __init__(self):
        super().__init__()
        self.effective_date = datetime.now().strftime("%d %B %Y")

    def header(self):
        """Add header with logo and company details."""
        # Logo (left side)
        if LOGO_PATH.exists():
            self.image(str(LOGO_PATH), x=10, y=8, w=50)

        # Company details (right side)
        self.set_xy(120, 10)
        self.set_font("Helvetica", "B", 14)
        self.set_text_color(192, 0, 0)  # Red color matching example
        self.cell(0, 6, COMPANY_NAME, align="R")

        self.set_xy(120, 18)
        self.set_font("Helvetica", "", 10)
        self.set_text_color(0, 0, 0)
        self.cell(0, 5, COMPANY_EMAIL, align="R")

        self.set_xy(120, 24)
        self.cell(0, 5, COMPANY_ADDRESS, align="R")

        self.ln(30)

    def add_title(self):
        """Add the pricing effective date title."""
        self.set_font("Helvetica", "B", 16)
        self.set_text_color(192, 0, 0)  # Red
        self.cell(0, 10, f"Pricing Effective {self.effective_date}", ln=True)
        self.set_text_color(0, 0, 0)
        self.ln(5)

    def add_table_header(self):
        """Add the table header row."""
        self.set_font("Helvetica", "B", 10)
        self.set_fill_color(192, 0, 0)  # Red background
        self.set_text_color(255, 255, 255)  # White text

        col_widths = [100, 40, 50]  # Product, Unit Price, Bulk Price
        headers = ["Product", "Unit Price", "Bulk Price (+10 carton)"]

        for i, header in enumerate(headers):
            align = "L" if i == 0 else "C"
            self.cell(col_widths[i], 10, header, border=1, align=align, fill=True)
        self.ln()

        self.set_text_color(0, 0, 0)

    def add_product_row(self, product_name: str, unit_price: float | None, bulk_price: float | None):
        """Add a single product row."""
        self.set_font("Helvetica", "", 10)
        col_widths = [100, 40, 50]

        self.cell(col_widths[0], 8, product_name, border=1)
        self.cell(col_widths[1], 8, format_currency(unit_price) if unit_price else "", border=1, align="C")
        self.cell(col_widths[2], 8, format_currency(bulk_price) if bulk_price else "", border=1, align="C")
        self.ln()


def format_currency(amount: float | Decimal | None) -> str:
    """Format amount as currency."""
    if amount is None:
        return ""
    return f"${float(amount):,.2f}"


def fetch_products(conn, price_source: str = "xero", product_group: str | None = None) -> list[dict]:
    """
    Fetch products for the price list.

    Args:
        conn: Database connection
        price_source: "xero" to use price field, "custom" to use price_list_price
        product_group: Optional filter by product group

    Returns:
        List of product dictionaries with name, unit_price, bulk_price
    """
    query = """
        SELECT
            item_name,
            price,
            price_list_price,
            bulk_price
        FROM dw.dim_product
        WHERE archived = false
          AND is_tracked_as_inventory = true
    """
    params = []

    if product_group:
        query += " AND product_group = %s"
        params.append(product_group)

    query += " ORDER BY item_name"

    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    products = []
    for row in rows:
        item_name, price, price_list_price, bulk_price = row

        # Determine unit price based on source
        if price_source == "custom" and price_list_price is not None:
            unit_price = price_list_price
        else:
            unit_price = price

        products.append({
            "name": item_name,
            "unit_price": float(unit_price) if unit_price else None,
            "bulk_price": float(bulk_price) if bulk_price else None,
        })

    return products


def generate_price_list_pdf(products: list[dict]) -> bytes:
    """Generate the price list PDF and return as bytes."""
    pdf = PriceListPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    pdf.add_title()
    pdf.add_table_header()

    for product in products:
        # Check for page break
        if pdf.get_y() > 270:
            pdf.add_page()
            pdf.add_table_header()

        pdf.add_product_row(
            product["name"],
            product["unit_price"],
            product["bulk_price"]
        )

    return bytes(pdf.output())
```

Next, modify `api/main.py` to add the price list endpoint. Add these imports near the top of the file:

```python
from generate_price_list_pdf import fetch_products as fetch_price_list_products, generate_price_list_pdf
```

Add the endpoint after the existing statement endpoints:

```python
@app.get("/api/price-list/pdf")
async def get_price_list_pdf(
    price_source: str = "xero",
    product_group: str | None = None
):
    """Generate and download PDF price list."""
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise HTTPException(status_code=500, detail="Database connection not configured")

    try:
        with psycopg.connect(conn_str) as conn:
            products = fetch_price_list_products(conn, price_source, product_group)

            if not products:
                raise HTTPException(status_code=404, detail="No products found")

            pdf_bytes = generate_price_list_pdf(products)

            timestamp = datetime.now().strftime("%Y%m%d")
            filename = f"Price_List_{timestamp}.pdf"

            return StreamingResponse(
                io.BytesIO(pdf_bytes),
                media_type="application/pdf",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

### Commands and Verification

Create the assets directory and logo:

    mkdir -p scripts/assets

For the logo, either manually export the SVG to PNG using a graphics tool, or if cairosvg is available:

    python -c "from cairosvg import svg2png; svg2png(url='Klipon logo.svg', write_to='scripts/assets/klipon-logo.png', output_width=200)"

Start the API server:

    cd /Users/damiengreen/Desktop/Data\ Warehouse
    uvicorn api.main:app --reload --port 8001

Test the endpoint with curl:

    curl -o test_price_list.pdf "http://localhost:8001/api/price-list/pdf"

Expected: A file `test_price_list.pdf` is created. Open it to verify:
- Klipon logo appears in top-left
- "AKINA TRADING LTD" in red appears top-right with contact details
- "Pricing Effective [today's date]" appears as title
- Product table has red header with "Product", "Unit Price", "Bulk Price (+10 carton)"
- Products are listed alphabetically with prices formatted as $XX.XX

Test with custom price source:

    curl -o test_custom.pdf "http://localhost:8001/api/price-list/pdf?price_source=custom"

Test with product group filter:

    curl -o test_filtered.pdf "http://localhost:8001/api/price-list/pdf?product_group=KiwiKlip"

### Completion Criteria

The milestone is complete when: (1) the API endpoint returns a valid PDF, (2) the PDF displays the logo, company details, and formatted product table, and (3) both price_source options work correctly. Update Progress to mark Milestone 2 complete, commit with message "Add price list PDF generation endpoint", and stop.


## Milestone 3: Frontend Integration

### Goal

At the end of this milestone, the Products page has an "Export Price List" button that opens a modal. The modal lets users select the price source (Xero or Custom) and download the PDF. Additionally, the product edit modal includes fields for Price List Price and Bulk Price, allowing users to set these values per product.

### Prerequisites

Milestones 1 and 2 must be complete: the database has the new columns, the RPC accepts the new parameters, and the API endpoint generates PDFs. The frontend must be runnable (`cd frontend && npm run dev`).

### Context for This Milestone

The Products page is at `frontend/src/pages/Products.tsx`. It currently has:
- A header with "Products" title and "Manage Clusters" button
- Product table with columns for Code, Name, Group, Price, Purchase Price, Qty, Cluster, Actions
- An edit modal that opens when clicking the pencil icon on a product row
- State: `editingProduct` (the product being edited) and `editForm` (form field values)
- Save function that calls `supabase.rpc('update_product', {...})`

The Product interface must be extended to include the new fields:

```typescript
interface Product {
    // ... existing fields ...
    price_list_price: number | null;
    bulk_price: number | null;
}
```

The editForm state must be extended:

```typescript
const [editForm, setEditForm] = useState({
    // ... existing fields ...
    price_list_price: '',
    bulk_price: '',
});
```

For the export functionality, we need:
- New state for export modal visibility
- New state for selected price source
- A function to trigger the PDF download via the API

The API URL for the backend is typically `http://localhost:8001` in development. The frontend should construct the URL and trigger a download.

### Work

Open `frontend/src/pages/Products.tsx` and make the following changes:

1. **Add Download icon import**. Near the top where other icons are imported from lucide-react, add `Download`:

```typescript
import {
    Loader2, Search, Package, Layers,
    ChevronDown, ChevronUp, Filter, Pencil, Tag, Download
} from 'lucide-react';
```

2. **Extend the Product interface**. Add the two new fields after the existing packaging fields:

```typescript
interface Product {
    // ... existing fields through cartons_per_pallet ...
    price_list_price: number | null;
    bulk_price: number | null;
}
```

3. **Add export modal state**. After the existing state declarations (around line 45), add:

```typescript
// Export modal state
const [showExportModal, setShowExportModal] = useState(false);
const [exportPriceSource, setExportPriceSource] = useState<'xero' | 'custom'>('xero');
const [exporting, setExporting] = useState(false);
```

4. **Extend editForm state**. Add the new fields to the initial state object:

```typescript
const [editForm, setEditForm] = useState({
    product_group: '',
    carton_width_mm: '',
    carton_height_mm: '',
    carton_depth_mm: '',
    carton_weight_kg: '',
    cartons_per_pallet: '',
    price_list_price: '',
    bulk_price: '',
});
```

5. **Update fetchProducts query**. In the select statement, add the new fields:

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
    price_list_price,
    bulk_price,
    dim_product_cluster (
        cluster_id,
        dim_cluster (
            cluster_id,
            cluster_label
        )
    )
`)
```

6. **Update startEditing function**. Add the new fields to the editForm initialization:

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
        price_list_price: product.price_list_price?.toString() || '',
        bulk_price: product.bulk_price?.toString() || '',
    });
};
```

7. **Update saveProduct function**. Add the new fields to the RPC call:

```typescript
const { error } = await supabase.rpc('update_product', {
    p_product_id: editingProduct.product_id,
    p_product_group: editForm.product_group || null,
    p_carton_width_mm: editForm.carton_width_mm ? parseInt(editForm.carton_width_mm) : null,
    p_carton_height_mm: editForm.carton_height_mm ? parseInt(editForm.carton_height_mm) : null,
    p_carton_depth_mm: editForm.carton_depth_mm ? parseInt(editForm.carton_depth_mm) : null,
    p_carton_weight_kg: editForm.carton_weight_kg ? parseFloat(editForm.carton_weight_kg) : null,
    p_cartons_per_pallet: editForm.cartons_per_pallet ? parseInt(editForm.cartons_per_pallet) : null,
    p_price_list_price: editForm.price_list_price ? parseFloat(editForm.price_list_price) : null,
    p_bulk_price: editForm.bulk_price ? parseFloat(editForm.bulk_price) : null,
});
```

8. **Add export function**. Add this function after saveProduct:

```typescript
const handleExportPriceList = async () => {
    setExporting(true);
    try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
        const url = `${apiUrl}/api/price-list/pdf?price_source=${exportPriceSource}`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to generate PDF');

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `Price_List_${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(downloadUrl);

        setShowExportModal(false);
    } catch (error) {
        console.error('Export failed:', error);
        alert('Failed to export price list. Please try again.');
    } finally {
        setExporting(false);
    }
};
```

9. **Add Export button to header**. In the header section, add the Export button before the "Manage Clusters" button:

```tsx
<div className="flex gap-2">
    <button
        onClick={() => setShowExportModal(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
    >
        <Download className="h-4 w-4" />
        Export Price List
    </button>
    <button
        onClick={navigateToClusterManagement}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
    >
        <Tag className="h-4 w-4" />
        Manage Clusters
    </button>
</div>
```

10. **Add Export Modal**. Add this JSX after the edit modal (before the final closing `</div>`):

```tsx
{/* Export Price List Modal */}
{showExportModal && (
    <div className="fixed inset-0 z-50 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
            <div
                className="fixed inset-0 bg-black/50 transition-opacity"
                onClick={() => setShowExportModal(false)}
            />
            <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Export Price List</h2>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Price Source
                        </label>
                        <div className="space-y-2">
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="priceSource"
                                    value="xero"
                                    checked={exportPriceSource === 'xero'}
                                    onChange={() => setExportPriceSource('xero')}
                                    className="h-4 w-4 text-blue-600"
                                />
                                <span className="text-sm text-gray-700">Xero Prices (synced from accounting)</span>
                            </label>
                            <label className="flex items-center gap-2">
                                <input
                                    type="radio"
                                    name="priceSource"
                                    value="custom"
                                    checked={exportPriceSource === 'custom'}
                                    onChange={() => setExportPriceSource('custom')}
                                    className="h-4 w-4 text-blue-600"
                                />
                                <span className="text-sm text-gray-700">Custom Prices (price list overrides)</span>
                            </label>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        onClick={() => setShowExportModal(false)}
                        className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleExportPriceList}
                        disabled={exporting}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                        {exporting && <Loader2 className="h-4 w-4 animate-spin" />}
                        <Download className="h-4 w-4" />
                        Download PDF
                    </button>
                </div>
            </div>
        </div>
    </div>
)}
```

11. **Add Pricing section to edit modal**. In the edit modal, after the Carton Packaging section (after the weight/pallet grid), add:

```tsx
{/* Pricing Section Header */}
<div className="border-t pt-4">
    <h3 className="text-sm font-medium text-gray-900 mb-3">Price List Settings</h3>
</div>

{/* Price List Fields */}
<div className="grid grid-cols-2 gap-3">
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
            Price List Price ($)
        </label>
        <input
            type="number"
            min="0"
            step="0.01"
            value={editForm.price_list_price}
            onChange={(e) => setEditForm(prev => ({ ...prev, price_list_price: e.target.value }))}
            placeholder={editingProduct?.price?.toString() || '—'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">Leave blank to use Xero price</p>
    </div>
    <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
            Bulk Price ($)
        </label>
        <input
            type="number"
            min="0"
            step="0.01"
            value={editForm.bulk_price}
            onChange={(e) => setEditForm(prev => ({ ...prev, bulk_price: e.target.value }))}
            placeholder="—"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-1">Price for 10+ carton orders</p>
    </div>
</div>
```

### Commands and Verification

Ensure both backend and frontend are running:

    # Terminal 1 - Backend
    cd /Users/damiengreen/Desktop/Data\ Warehouse
    uvicorn api.main:app --reload --port 8001

    # Terminal 2 - Frontend
    cd /Users/damiengreen/Desktop/Data\ Warehouse/frontend
    npm run dev

Open the browser to `http://localhost:5173/products` (or wherever the frontend runs).

Verify the Export button:
1. The "Export Price List" button appears in the header next to "Manage Clusters"
2. Clicking it opens a modal with price source radio buttons
3. Selecting "Xero Prices" and clicking "Download PDF" downloads a PDF file
4. The PDF contains products with their prices

Verify the edit modal:
1. Click the pencil icon on any product row
2. The modal shows a new "Price List Settings" section below "Carton Packaging"
3. Enter a value in "Price List Price" (e.g., 99.99) and "Bulk Price" (e.g., 89.99)
4. Click "Save Changes"
5. Re-open the modal - the values should persist

Verify custom prices in export:
1. Edit a product and set a Price List Price different from its Xero price
2. Export with "Xero Prices" - should show original price
3. Export with "Custom Prices" - should show the Price List Price you entered

### Completion Criteria

The milestone is complete when: (1) the Export button opens a working modal, (2) PDF download works for both price sources, (3) the edit modal includes working Price List Price and Bulk Price fields, and (4) saved values persist and appear in exports. Update Progress to mark Milestone 3 complete, commit with message "Add price list export UI and pricing fields to product editor", and stop.


## Interfaces and Dependencies

**Python Dependencies** (already in requirements.txt):
- `fpdf` or `fpdf2` - PDF generation library
- `psycopg` - PostgreSQL database driver
- `fastapi` - Web framework
- `python-dotenv` - Environment variable loading

**Frontend Dependencies** (already in package.json):
- `@supabase/supabase-js` - Database client
- `lucide-react` - Icons (Download icon needed)

**Database Schema Additions**:

```sql
-- New columns in dw.dim_product
price_list_price numeric(18,2)  -- Custom price for exports
bulk_price numeric(18,2)        -- Bulk order price
```

**RPC Function Signature** (final):

```sql
public.update_product(
    p_product_id bigint,
    p_product_group text,
    p_carton_width_mm integer,
    p_carton_height_mm integer,
    p_carton_depth_mm integer,
    p_carton_weight_kg numeric,
    p_cartons_per_pallet integer,
    p_price_list_price numeric,  -- NEW
    p_bulk_price numeric         -- NEW
) RETURNS void
```

**API Endpoint**:

```
GET /api/price-list/pdf?price_source={xero|custom}&product_group={optional}
Response: application/pdf
```

**TypeScript Interface** (extended):

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
    carton_width_mm: number | null;
    carton_height_mm: number | null;
    carton_depth_mm: number | null;
    carton_weight_kg: number | null;
    cartons_per_pallet: number | null;
    price_list_price: number | null;  // NEW
    bulk_price: number | null;         // NEW
}
```


## Idempotence and Recovery

**Database Migration**: The migration uses `ADD COLUMN IF NOT EXISTS`, making it safe to run multiple times. If the columns already exist, the statement succeeds without error.

**RPC Function**: `CREATE OR REPLACE FUNCTION` is inherently idempotent - running it multiple times simply updates the function definition.

**Logo Asset**: Creating the PNG from SVG can be repeated safely. The file is simply overwritten.

**Frontend Changes**: Code edits are idempotent in nature - the same edit applied twice results in the same code.

**Recovery from Partial State**:
- If Milestone 1 partially completes, re-run the migration - it handles existing columns gracefully.
- If Milestone 2 has issues, the API endpoint can be updated/fixed independently.
- If Milestone 3 has issues, frontend changes can be reverted via git and reapplied.


## Artifacts and Notes

**Example PDF Output Layout**:

```
+----------------------------------------------------------+
|  [KLIPON LOGO]                    AKINA TRADING LTD      |
|                                   admin@klipon.co.nz     |
|                                   44 Tukorako Dr, Mt     |
|                                   Maunganui, NZ          |
+----------------------------------------------------------+
|  Pricing Effective 19 January 2026                       |
+----------------------------------------------------------+
| Product                  | Unit Price | Bulk Price       |
|                          |            | (+10 carton)     |
+----------------------------------------------------------+
| Kiwiklip- Black - 20,000 |   $335.31  |     $300.51      |
| KiwiKlip - Black - 1,000 |    $18.31  |                  |
| Kiwiklip - coloured...   |   $368.01  |     $338.53      |
+----------------------------------------------------------+
```

**Example API Response Headers**:

```
Content-Type: application/pdf
Content-Disposition: attachment; filename=Price_List_20260119.pdf
```

**Example RPC Call from Frontend**:

```typescript
await supabase.rpc('update_product', {
    p_product_id: 123,
    p_price_list_price: 99.99,
    p_bulk_price: 89.99
});
```
