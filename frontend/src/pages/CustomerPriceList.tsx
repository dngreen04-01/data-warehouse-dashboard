import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    ArrowLeft, Printer, Save, Loader2, Search, RotateCcw
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
    isCustom?: boolean;  // true if price differs from default (saved or modified)
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
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [filterValue, setFilterValue] = useState('');
    const [hasChanges, setHasChanges] = useState(false);

    // Fetch customer data, price list, and all products
    useEffect(() => {
        async function loadData() {
            if (!customerId) return;
            setIsLoading(true);

            try {
                // Load all products first
                const { data: productsData } = await supabase
                    .schema('dw')
                    .from('dim_product')
                    .select('product_id, product_code, item_name, price, bulk_price')
                    .eq('archived', false)
                    .eq('is_tracked_as_inventory', true)
                    .order('item_name');

                if (!productsData) {
                    throw new Error('Failed to load products');
                }

                // Then fetch price list from API
                const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
                const response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list`);

                if (!response.ok) throw new Error('Failed to load price list');

                const data = await response.json();
                setCustomer({ customer_id: data.customer_id, customer_name: data.customer_name });

                if (data.price_list) {
                    setPriceList(data.price_list);
                }

                // Merge all products with any existing overrides
                const existingOverrides = data.price_list?.overrides || [];
                const overrideMap = new Map(
                    existingOverrides.map((o: PriceOverride) => [o.product_id, o])
                );

                const allProductPrices: PriceOverride[] = productsData.map((p: Product) => {
                    const existing = overrideMap.get(p.product_id) as PriceOverride | undefined;
                    // Check if there's a saved override with different price
                    const hasCustomPrice = existing !== undefined;
                    return {
                        product_id: p.product_id,
                        product_code: p.product_code,
                        item_name: p.item_name,
                        default_price: p.price,
                        default_bulk_price: p.bulk_price,
                        custom_price: existing?.custom_price?.toString() ?? p.price?.toString() ?? '',
                        custom_bulk_price: existing?.custom_bulk_price?.toString() ?? p.bulk_price?.toString() ?? '',
                        isCustom: hasCustomPrice,
                    };
                });

                setOverrides(allProductPrices);
            } catch (error) {
                console.error('Error loading data:', error);
                alert('Failed to load customer data');
            } finally {
                setIsLoading(false);
            }
        }

        loadData();
    }, [customerId]);

    // Filter products by search term
    const filteredOverrides = useMemo(() => {
        if (!filterValue) return overrides;
        const lower = filterValue.toLowerCase();
        return overrides.filter(o =>
            o.item_name.toLowerCase().includes(lower) ||
            o.product_code.toLowerCase().includes(lower)
        );
    }, [overrides, filterValue]);

    // Count custom prices
    const customCount = useMemo(() => {
        return overrides.filter(o => o.isCustom).length;
    }, [overrides]);

    const handlePriceChange = (productId: number, field: 'custom_price' | 'custom_bulk_price', value: string) => {
        setOverrides(overrides.map(o => {
            if (o.product_id !== productId) return o;
            const updated = { ...o, [field]: value };
            // Mark as custom if price differs from default
            const customPrice = parseFloat(updated.custom_price);
            const customBulk = updated.custom_bulk_price ? parseFloat(updated.custom_bulk_price) : null;
            const priceChanged = !isNaN(customPrice) && customPrice !== o.default_price;
            const bulkChanged = customBulk !== null && !isNaN(customBulk) && customBulk !== o.default_bulk_price;
            return { ...updated, isCustom: priceChanged || bulkChanged };
        }));
        setHasChanges(true);
    };

    const handleResetPrice = (productId: number) => {
        setOverrides(overrides.map(o => {
            if (o.product_id !== productId) return o;
            return {
                ...o,
                custom_price: o.default_price?.toString() ?? '',
                custom_bulk_price: o.default_bulk_price?.toString() ?? '',
                isCustom: false,
            };
        }));
        setHasChanges(true);
    };

    const handleSave = async () => {
        if (!customerId) return;
        setIsSaving(true);

        try {
            const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';

            // Only save products where prices differ from defaults
            const customOverrides = overrides.filter(o => {
                const customPrice = parseFloat(o.custom_price);
                const customBulk = o.custom_bulk_price ? parseFloat(o.custom_bulk_price) : null;
                const priceChanged = !isNaN(customPrice) && customPrice !== o.default_price;
                const bulkChanged = customBulk !== null && !isNaN(customBulk) && customBulk !== o.default_bulk_price;
                return priceChanged || bulkChanged;
            });

            const payload = {
                name: priceList?.name || 'Custom Prices',
                overrides: customOverrides.map(o => ({
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
            // Always include all products in the PDF
            const response = await fetch(`${apiUrl}/api/customers/${customerId}/price-list/pdf?include_all=true`);

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
                            {customCount > 0
                                ? `${customCount} custom price${customCount !== 1 ? 's' : ''}`
                                : 'All default prices'
                            }
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handlePrint}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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

            {/* Price Table */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-gray-900">Product Prices</h2>
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                                {overrides.length} products
                            </span>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Filter products..."
                                value={filterValue}
                                onChange={(e) => setFilterValue(e.target.value)}
                                className="w-full sm:w-64 rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    </div>
                </div>
                <div className="p-6">
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
                                        Price
                                    </th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Bulk Price
                                    </th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        <span className="sr-only">Actions</span>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredOverrides.map(override => (
                                    <tr key={override.product_id} className="hover:bg-gray-50">
                                        <td className="whitespace-nowrap px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <span className="font-medium text-gray-900">
                                                    {override.item_name}
                                                </span>
                                                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                                    {override.product_code}
                                                </span>
                                                {override.isCustom && (
                                                    <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                                                        Custom
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
                                                    className={clsx(
                                                        'w-24 rounded-lg border px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
                                                        override.isCustom ? 'border-green-300 bg-green-50' : 'border-gray-300'
                                                    )}
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
                                                    className={clsx(
                                                        'w-24 rounded-lg border px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
                                                        override.isCustom ? 'border-green-300 bg-green-50' : 'border-gray-300'
                                                    )}
                                                />
                                            </div>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-right">
                                            {override.isCustom && (
                                                <button
                                                    onClick={() => handleResetPrice(override.product_id)}
                                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    title="Reset to default"
                                                >
                                                    <RotateCcw className="h-4 w-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {filteredOverrides.length === 0 && filterValue && (
                        <div className="py-12 text-center">
                            <p className="text-sm text-gray-500">
                                No products match "{filterValue}"
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
