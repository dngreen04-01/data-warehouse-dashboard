import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, Plus, Trash2, Printer, Save, Loader2, Search, X
} from 'lucide-react';
import clsx from 'clsx';

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

    const searchRef = useRef<HTMLDivElement>(null);

    // Close search dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setSearchOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

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
                    setOverrides(data.price_list.overrides.map((o: PriceOverride) => ({
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

    const formatCurrency = (value: number | string | null) => {
        if (value === null || value === undefined || value === '') return '-';
        const num = typeof value === 'string' ? parseFloat(value) : value;
        if (isNaN(num)) return '-';
        return `$${num.toFixed(2)}`;
    };

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => navigate('/customers')}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                            {customer?.customer_name}
                        </h1>
                        <p className="text-sm text-gray-500">
                            {priceList ? `Price List: ${priceList.name}` : 'No custom price list'}
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handlePrint}
                        disabled={overrides.length === 0}
                        className={clsx(
                            'inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                            overrides.length === 0
                                ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                                : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        )}
                    >
                        <Printer className="h-4 w-4" />
                        Print PDF
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!hasChanges || isSaving}
                        className={clsx(
                            'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors',
                            !hasChanges || isSaving
                                ? 'bg-blue-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700'
                        )}
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Changes
                    </button>
                </div>
            </div>

            {/* Product Search */}
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Add Products</h2>
                <div className="relative" ref={searchRef}>
                    <button
                        onClick={() => setSearchOpen(!searchOpen)}
                        className="flex w-full items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                        Search and add products...
                    </button>
                    {searchOpen && (
                        <div className="absolute left-0 right-0 z-10 mt-1 max-h-80 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                            <div className="sticky top-0 border-b border-gray-200 bg-white p-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        placeholder="Search products..."
                                        value={searchValue}
                                        onChange={(e) => setSearchValue(e.target.value)}
                                        autoFocus
                                        className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    />
                                </div>
                            </div>
                            {filteredProducts.length === 0 ? (
                                <div className="px-4 py-8 text-center text-sm text-gray-500">
                                    No products found.
                                </div>
                            ) : (
                                <ul className="py-1">
                                    {filteredProducts.map(product => (
                                        <li key={product.product_id}>
                                            <button
                                                onClick={() => handleAddProduct(product)}
                                                className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-50"
                                            >
                                                <div>
                                                    <span className="text-sm font-medium text-gray-900">
                                                        {product.item_name}
                                                    </span>
                                                    <span className="ml-2 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                                        {product.product_code}
                                                    </span>
                                                </div>
                                                <span className="text-sm text-gray-500">
                                                    {formatCurrency(product.price)}
                                                </span>
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Price Overrides Table */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-4">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-semibold text-gray-900">Custom Prices</h2>
                        {overrides.length > 0 && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                                {overrides.length} products
                            </span>
                        )}
                    </div>
                </div>
                <div className="p-6">
                    {overrides.length === 0 ? (
                        <div className="py-12 text-center">
                            <p className="text-sm text-gray-500">
                                No custom prices set. Add products above to create custom pricing.
                            </p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-gray-200">
                                <thead>
                                    <tr>
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            Product
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            Default Price
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            Custom Price
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            Custom Bulk
                                        </th>
                                        <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                            <span className="sr-only">Actions</span>
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {overrides.map(override => (
                                        <tr key={override.product_id} className="hover:bg-gray-50">
                                            <td className="whitespace-nowrap px-4 py-3">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium text-gray-900">
                                                        {override.item_name}
                                                    </span>
                                                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                                        {override.product_code}
                                                    </span>
                                                    {override.isNew && (
                                                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                                                            New
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                                                {formatCurrency(override.default_price)}
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3">
                                                <div className="flex items-center">
                                                    <span className="mr-1 text-gray-500">$</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={override.custom_price}
                                                        onChange={(e) => handlePriceChange(override.product_id, 'custom_price', e.target.value)}
                                                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3">
                                                <div className="flex items-center">
                                                    <span className="mr-1 text-gray-500">$</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={override.custom_bulk_price}
                                                        onChange={(e) => handlePriceChange(override.product_id, 'custom_bulk_price', e.target.value)}
                                                        placeholder="Optional"
                                                        className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                    />
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-4 py-3 text-right">
                                                <button
                                                    onClick={() => handleRemoveOverride(override.product_id)}
                                                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                    title="Remove"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
