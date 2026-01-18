import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    Loader2, Search, Package, Layers,
    ChevronDown, ChevronUp, Filter, Pencil, Tag
} from 'lucide-react';
import clsx from 'clsx';

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

type SortField = 'product_code' | 'item_name' | 'product_group';
type SortDirection = 'asc' | 'desc';

export default function Products() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [products, setProducts] = useState<Product[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState<SortField>('item_name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [filterGroup, setFilterGroup] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);
    const [productGroups, setProductGroups] = useState<string[]>([]);

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

    useEffect(() => {
        fetchProducts();
        fetchProductGroups();
    }, []);

    const fetchProducts = async () => {
        setLoading(true);
        try {
            // Direct query to dw schema for inventory-tracked products with cluster info
            const { data, error } = await supabase
                .schema('dw')
                .from('dim_product')
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
                .eq('archived', false)
                .eq('is_tracked_as_inventory', true)
                .order('item_name');

            if (error) {
                console.error('Error fetching products:', error);
                // Fallback without cluster join
                const { data: fallbackData } = await supabase
                    .schema('dw')
                    .from('dim_product')
                    .select('*')
                    .eq('archived', false)
                    .eq('is_tracked_as_inventory', true)
                    .order('item_name');
                setProducts((fallbackData || []).map(p => ({
                    ...p,
                    cluster_id: null,
                    cluster_label: null
                })));
            } else {
                // Map joined data to flat structure
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
                setProducts(mappedProducts);
            }
        } catch (error) {
            console.error('Error fetching products:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchProductGroups = async () => {
        try {
            const { data } = await supabase.rpc('get_distinct_product_groups');
            if (data) {
                setProductGroups(data.map((d: { product_group: string }) => d.product_group));
            }
        } catch {
            // Fallback: extract from products
            const { data } = await supabase
                .from('dim_product')
                .select('product_group')
                .eq('archived', false);
            const uniqueGroups = [...new Set((data || []).map(p => p.product_group).filter(Boolean))];
            setProductGroups(uniqueGroups as string[]);
        }
    };

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc'
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />;
    };

    const filteredAndSortedProducts = useMemo(() => {
        let result = [...products];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(p =>
                p.item_name?.toLowerCase().includes(query) ||
                p.product_code?.toLowerCase().includes(query) ||
                p.product_group?.toLowerCase().includes(query)
            );
        }

        // Apply group filter
        if (filterGroup) {
            result = result.filter(p => p.product_group === filterGroup);
        }

        // Apply sorting
        result.sort((a, b) => {
            let aVal = a[sortField] ?? '';
            let bVal = b[sortField] ?? '';

            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();

            if (sortDirection === 'asc') {
                return aVal.localeCompare(bVal);
            }
            return bVal.localeCompare(aVal);
        });

        return result;
    }, [products, searchQuery, filterGroup, sortField, sortDirection]);

    const clearFilters = () => {
        setFilterGroup('');
        setSearchQuery('');
    };

    const activeFilterCount = filterGroup ? 1 : 0;

    // Group products by product_group for summary cards
    const groupSummary = useMemo(() => {
        const summary: Record<string, number> = {};
        products.forEach(p => {
            const group = p.product_group || 'Uncategorized';
            summary[group] = (summary[group] || 0) + 1;
        });
        return Object.entries(summary)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    }, [products]);

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

    const navigateToClusterManagement = () => {
        navigate('/clusters');
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Products</h1>
                    <p className="text-sm text-gray-500">
                        Product catalog ({filteredAndSortedProducts.length} products)
                    </p>
                </div>
                <button
                    onClick={navigateToClusterManagement}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                    <Tag className="h-4 w-4" />
                    Manage Clusters
                </button>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                {groupSummary.map(([group, count]) => (
                    <button
                        key={group}
                        onClick={() => {
                            setFilterGroup(filterGroup === group ? '' : group);
                            setShowFilters(true);
                        }}
                        className={clsx(
                            'rounded-xl border p-4 text-left transition-all hover:shadow-md',
                            filterGroup === group
                                ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-500'
                                : 'border-gray-200 bg-white hover:border-gray-300'
                        )}
                    >
                        <div className="flex items-center gap-3">
                            <div className={clsx(
                                'flex h-10 w-10 items-center justify-center rounded-lg',
                                filterGroup === group ? 'bg-blue-100' : 'bg-gray-100'
                            )}>
                                <Layers className={clsx(
                                    'h-5 w-5',
                                    filterGroup === group ? 'text-blue-600' : 'text-gray-500'
                                )} />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-gray-900 truncate max-w-[100px]" title={group}>
                                    {group}
                                </p>
                                <p className="text-xs text-gray-500">{count} products</p>
                            </div>
                        </div>
                    </button>
                ))}
            </div>

            {/* Search & Filters Bar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search products, codes, groups..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={clsx(
                        'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                        showFilters || activeFilterCount > 0
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    )}
                >
                    <Filter className="h-4 w-4" />
                    Filters
                    {activeFilterCount > 0 && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                            {activeFilterCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm animate-in slide-in-from-top-2">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900">Filter Products</h3>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearFilters}
                                className="text-sm text-red-600 hover:underline"
                            >
                                Clear All
                            </button>
                        )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-gray-700">Product Group</label>
                            <select
                                value={filterGroup}
                                onChange={(e) => setFilterGroup(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">All Groups</option>
                                {productGroups.map(g => (
                                    <option key={g} value={g}>{g}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Product Table */}
            {loading ? (
                <div className="flex h-96 items-center justify-center">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                </div>
            ) : (
                <div className="-mx-4 sm:-mx-6 lg:-mx-8 overflow-hidden border-y border-gray-200 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th
                                        className="cursor-pointer px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
                                        onClick={() => handleSort('product_code')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Code
                                            <SortIcon field="product_code" />
                                        </div>
                                    </th>
                                    <th
                                        className="cursor-pointer px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
                                        onClick={() => handleSort('item_name')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Product Name
                                            <SortIcon field="item_name" />
                                        </div>
                                    </th>
                                    <th
                                        className="cursor-pointer px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
                                        onClick={() => handleSort('product_group')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Group
                                            <SortIcon field="product_group" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Price
                                    </th>
                                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Purchase Price
                                    </th>
                                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Qty on Hand
                                    </th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Cluster
                                    </th>
                                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {filteredAndSortedProducts.length === 0 ? (
                                    <tr>
                                        <td colSpan={8} className="px-6 py-12 text-center">
                                            <Package className="mx-auto h-12 w-12 text-gray-300" />
                                            <p className="mt-2 text-sm text-gray-500">No products found</p>
                                            {(searchQuery || activeFilterCount > 0) && (
                                                <button
                                                    onClick={clearFilters}
                                                    className="mt-2 text-sm text-blue-600 hover:underline"
                                                >
                                                    Clear filters
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAndSortedProducts.map((product) => (
                                        <tr
                                            key={product.product_id}
                                            className="hover:bg-gray-50 transition-colors"
                                        >
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <span className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-1 text-sm font-mono font-medium text-gray-700">
                                                    {product.product_code}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-100 to-emerald-200">
                                                        <Package className="h-5 w-5 text-emerald-600" />
                                                    </div>
                                                    <span className="font-medium text-gray-900">
                                                        {product.item_name}
                                                    </span>
                                                </div>
                                            </td>
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
                                            <td className="whitespace-nowrap px-6 py-4 text-right">
                                                <span className="text-sm font-medium text-gray-900">
                                                    {product.price != null ? `$${Number(product.price).toFixed(2)}` : '-'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right">
                                                <span className="text-sm text-gray-600">
                                                    {product.purchase_unit_price != null ? `$${Number(product.purchase_unit_price).toFixed(2)}` : '-'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right">
                                                <span className={clsx(
                                                    'text-sm font-medium',
                                                    product.quantity_on_hand != null && Number(product.quantity_on_hand) <= 0
                                                        ? 'text-red-600'
                                                        : product.quantity_on_hand != null && Number(product.quantity_on_hand) <= 10
                                                            ? 'text-amber-600'
                                                            : 'text-gray-900'
                                                )}>
                                                    {product.quantity_on_hand != null ? Number(product.quantity_on_hand).toLocaleString() : '-'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                {product.cluster_label ? (
                                                    <button
                                                        onClick={navigateToClusterManagement}
                                                        className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 transition-colors"
                                                    >
                                                        <Tag className="h-3 w-3" />
                                                        {product.cluster_label}
                                                    </button>
                                                ) : (
                                                    <span className="text-sm text-gray-400">-</span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right">
                                                <button
                                                    onClick={() => startEditing(product)}
                                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    title="Edit product"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

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
        </div>
    );
}
