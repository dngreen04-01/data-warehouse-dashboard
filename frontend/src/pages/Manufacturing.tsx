import { useEffect, useState, useMemo } from 'react';
import {
    Loader2, Factory, Package, AlertTriangle, CheckCircle2,
    ArrowRight, History, Plus, Minus
} from 'lucide-react';
import clsx from 'clsx';

interface BulkProduct {
    product_code: string;
    item_name: string;
    quantity_on_hand: number | null;
    total_cost_pool: number | null;
    inventory_asset_account_code: string | null;
    bag_weight_kg: number;
    material_type: string;
    converts_to: string[];
    landed_cost_per_kg: number;  // NZD per kg (calculated from total_cost_pool / quantity_on_hand)
}

interface FinishedProduct {
    product_code: string;
    item_name: string;
    quantity_on_hand: number | null;
    total_cost_pool: number | null;
    inventory_asset_account_code: string | null;
    weight_kg: number;
    material_type: string;
    landed_cost_per_unit: number;  // NZD per unit
}

interface FinishedGoodEntry {
    product_code: string;
    product_name: string;
    quantity: number;
    unit_weight_kg: number;
}

interface ConversionRecord {
    conversion_id: number;
    conversion_date: string;
    bulk_product_code: string;
    bulk_product_name: string;
    bags_consumed: number;
    kg_consumed: number;
    bulk_unit_cost: number;
    bulk_total_value: number;
    finished_goods: Array<{
        product_code: string;
        product_name: string;
        quantity: number;
        unit_cost: number;
        total_value: number;
    }>;
    xero_credit_note_id: string | null;
    xero_invoice_id: string | null;
    created_at: string;
    notes: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001';

export default function Manufacturing() {
    // Data state
    const [bulkProducts, setBulkProducts] = useState<BulkProduct[]>([]);
    const [finishedProducts, setFinishedProducts] = useState<FinishedProduct[]>([]);
    const [history, setHistory] = useState<ConversionRecord[]>([]);

    // Form state
    const [selectedBulk, setSelectedBulk] = useState<string>('');
    const [bagsConsumed, setBagsConsumed] = useState<number>(0);
    const [finishedGoods, setFinishedGoods] = useState<FinishedGoodEntry[]>([]);
    const [conversionDate, setConversionDate] = useState<string>(
        new Date().toISOString().split('T')[0]
    );
    const [notes, setNotes] = useState<string>('');

    // UI state
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Fetch initial data
    useEffect(() => {
        fetchProducts();
        fetchHistory();
    }, []);

    const fetchProducts = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/manufacturing/products`);
            if (!response.ok) throw new Error('Failed to fetch products');
            const data = await response.json();
            setBulkProducts(data.bulk_products || []);
            setFinishedProducts(data.finished_products || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load products');
        } finally {
            setLoading(false);
        }
    };

    const fetchHistory = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/manufacturing/history?limit=20`);
            if (!response.ok) throw new Error('Failed to fetch history');
            const data = await response.json();
            setHistory(data.records || []);
        } catch (err) {
            console.error('Failed to fetch history:', err);
        }
    };

    // Get selected bulk product details
    const selectedBulkProduct = useMemo(() => {
        return bulkProducts.find(p => p.product_code === selectedBulk);
    }, [bulkProducts, selectedBulk]);

    // Filter finished products based on selected bulk material type
    const compatibleFinishedProducts = useMemo(() => {
        if (!selectedBulkProduct) return [];
        return finishedProducts.filter(
            p => p.material_type === selectedBulkProduct.material_type
        );
    }, [finishedProducts, selectedBulkProduct]);

    // Calculate values
    const calculations = useMemo(() => {
        if (!selectedBulkProduct || bagsConsumed <= 0) {
            return {
                kgConsumed: 0,
                bulkTotalValue: 0,
                totalFinishedKg: 0,
                yieldPercentage: 0,
                yieldWarning: false
            };
        }

        const kgConsumed = bagsConsumed * selectedBulkProduct.bag_weight_kg;
        const bulkUnitCost = selectedBulkProduct.landed_cost_per_kg || 0;  // NZD landed cost
        const bulkTotalValue = kgConsumed * bulkUnitCost;

        const totalFinishedKg = finishedGoods.reduce(
            (sum, fg) => sum + (fg.quantity * fg.unit_weight_kg),
            0
        );

        const yieldPercentage = kgConsumed > 0 ? (totalFinishedKg / kgConsumed) * 100 : 0;
        const yieldWarning = totalFinishedKg > 0 && (yieldPercentage < 90 || yieldPercentage > 100);

        return {
            kgConsumed,
            bulkTotalValue,
            totalFinishedKg,
            yieldPercentage,
            yieldWarning
        };
    }, [selectedBulkProduct, bagsConsumed, finishedGoods]);

    // Handle bulk selection change
    const handleBulkChange = (code: string) => {
        setSelectedBulk(code);
        setFinishedGoods([]); // Reset finished goods when bulk changes
    };

    // Add finished good entry
    const addFinishedGood = (product: FinishedProduct) => {
        const existing = finishedGoods.find(fg => fg.product_code === product.product_code);
        if (existing) return; // Already added

        setFinishedGoods([
            ...finishedGoods,
            {
                product_code: product.product_code,
                product_name: product.item_name,
                quantity: 0,
                unit_weight_kg: product.weight_kg
            }
        ]);
    };

    // Update finished good quantity
    const updateFinishedGoodQuantity = (productCode: string, quantity: number) => {
        setFinishedGoods(finishedGoods.map(fg =>
            fg.product_code === productCode
                ? { ...fg, quantity: Math.max(0, quantity) }
                : fg
        ));
    };

    // Remove finished good entry
    const removeFinishedGood = (productCode: string) => {
        setFinishedGoods(finishedGoods.filter(fg => fg.product_code !== productCode));
    };

    // Submit conversion
    const handleSubmit = async () => {
        setError(null);
        setSuccess(null);

        // Validation
        if (!selectedBulk) {
            setError('Please select a bulk product');
            return;
        }
        if (bagsConsumed <= 0) {
            setError('Please enter the number of bags consumed');
            return;
        }
        if (finishedGoods.length === 0 || finishedGoods.every(fg => fg.quantity <= 0)) {
            setError('Please enter quantities for at least one finished product');
            return;
        }

        setSubmitting(true);

        try {
            const response = await fetch(`${API_BASE}/api/manufacturing/convert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bulk_product_code: selectedBulk,
                    bags_consumed: bagsConsumed,
                    finished_goods: finishedGoods.filter(fg => fg.quantity > 0),
                    conversion_date: conversionDate,
                    notes: notes || null
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Conversion failed');
            }

            await response.json();
            setSuccess(`Conversion completed! ${calculations.kgConsumed}kg consumed, Xero updated.`);

            // Reset form
            setBagsConsumed(0);
            setFinishedGoods([]);
            setNotes('');

            // Refresh data
            fetchProducts();
            fetchHistory();

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Conversion failed');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Manufacturing</h1>
                <p className="text-sm text-gray-500">
                    Convert bulk materials to finished retail products
                </p>
            </div>

            {/* Alerts */}
            {error && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-red-800">Error</p>
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                </div>
            )}

            {success && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-4 flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-medium text-green-800">Success</p>
                        <p className="text-sm text-green-700">{success}</p>
                    </div>
                </div>
            )}

            {/* Main Form */}
            <div className="grid gap-6 lg:grid-cols-2">
                {/* Left: Input Section */}
                <div className="space-y-6">
                    {/* Bulk Material Selection */}
                    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                            <Package className="h-5 w-5 text-blue-600" />
                            Bulk Material
                        </h2>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    Select Bulk Product
                                </label>
                                <select
                                    value={selectedBulk}
                                    onChange={(e) => handleBulkChange(e.target.value)}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="">Choose bulk material...</option>
                                    {bulkProducts.map(product => (
                                        <option key={product.product_code} value={product.product_code}>
                                            {product.product_code} - {product.item_name}
                                            {product.quantity_on_hand != null && ` (${product.quantity_on_hand.toLocaleString()}kg available)`}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            {selectedBulkProduct && (
                                <>
                                    <div className="rounded-lg bg-gray-50 p-4 space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Bag Weight:</span>
                                            <span className="font-medium">{selectedBulkProduct.bag_weight_kg}kg</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Material Type:</span>
                                            <span className="font-medium capitalize">{selectedBulkProduct.material_type}</span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Landed Cost (NZD):</span>
                                            <span className="font-medium">
                                                ${(selectedBulkProduct.landed_cost_per_kg || 0).toFixed(2)}/kg
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-sm">
                                            <span className="text-gray-500">Available:</span>
                                            <span className={clsx(
                                                'font-medium',
                                                (selectedBulkProduct.quantity_on_hand || 0) <= 0 ? 'text-red-600' : 'text-green-600'
                                            )}>
                                                {(selectedBulkProduct.quantity_on_hand || 0).toLocaleString()}kg
                                            </span>
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Number of Bags Consumed
                                        </label>
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.5"
                                            value={bagsConsumed || ''}
                                            onChange={(e) => setBagsConsumed(parseFloat(e.target.value) || 0)}
                                            placeholder="Enter bags consumed"
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                        {bagsConsumed > 0 && (
                                            <p className="mt-1 text-sm text-gray-500">
                                                = {calculations.kgConsumed.toLocaleString()}kg
                                                {selectedBulkProduct.landed_cost_per_kg > 0 && (
                                                    <> (${calculations.bulkTotalValue.toFixed(2)} NZD value)</>
                                                )}
                                            </p>
                                        )}
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">
                                            Conversion Date
                                        </label>
                                        <input
                                            type="date"
                                            value={conversionDate}
                                            onChange={(e) => setConversionDate(e.target.value)}
                                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Notes */}
                    {selectedBulkProduct && (
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Notes (optional)
                            </label>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                placeholder="Add any notes about this conversion..."
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                    )}
                </div>

                {/* Right: Output Section */}
                <div className="space-y-6">
                    {/* Finished Products */}
                    {selectedBulkProduct && (
                        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                <Factory className="h-5 w-5 text-green-600" />
                                Finished Products
                            </h2>

                            {/* Add product buttons */}
                            <div className="flex flex-wrap gap-2 mb-4">
                                {compatibleFinishedProducts.map(product => {
                                    const isAdded = finishedGoods.some(fg => fg.product_code === product.product_code);
                                    return (
                                        <button
                                            key={product.product_code}
                                            onClick={() => addFinishedGood(product)}
                                            disabled={isAdded}
                                            className={clsx(
                                                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                                                isAdded
                                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                    : 'bg-green-50 text-green-700 hover:bg-green-100'
                                            )}
                                        >
                                            <Plus className="h-4 w-4" />
                                            {product.product_code} ({product.weight_kg}kg)
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Finished goods entries */}
                            {finishedGoods.length > 0 ? (
                                <div className="space-y-3">
                                    {finishedGoods.map(fg => {
                                        return (
                                            <div
                                                key={fg.product_code}
                                                className="flex items-center gap-3 rounded-lg border border-gray-200 p-3"
                                            >
                                                <div className="flex-1">
                                                    <p className="font-medium text-gray-900">{fg.product_code}</p>
                                                    <p className="text-xs text-gray-500">
                                                        {fg.product_name} ({fg.unit_weight_kg}kg each)
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => updateFinishedGoodQuantity(fg.product_code, fg.quantity - 1)}
                                                        className="p-1 rounded hover:bg-gray-100"
                                                    >
                                                        <Minus className="h-4 w-4" />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        value={fg.quantity || ''}
                                                        onChange={(e) => updateFinishedGoodQuantity(
                                                            fg.product_code,
                                                            parseInt(e.target.value) || 0
                                                        )}
                                                        className="w-20 rounded border border-gray-300 px-2 py-1 text-center text-sm"
                                                    />
                                                    <button
                                                        onClick={() => updateFinishedGoodQuantity(fg.product_code, fg.quantity + 1)}
                                                        className="p-1 rounded hover:bg-gray-100"
                                                    >
                                                        <Plus className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => removeFinishedGood(fg.product_code)}
                                                        className="p-1 rounded text-red-500 hover:bg-red-50"
                                                    >
                                                        <Minus className="h-4 w-4" />
                                                    </button>
                                                </div>
                                                <div className="text-right w-24">
                                                    <p className="text-sm font-medium">
                                                        {(fg.quantity * fg.unit_weight_kg).toFixed(1)}kg
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500 text-center py-4">
                                    Click buttons above to add finished products
                                </p>
                            )}
                        </div>
                    )}

                    {/* Summary & Yield Validation */}
                    {selectedBulkProduct && bagsConsumed > 0 && (
                        <div className={clsx(
                            'rounded-xl border p-6 shadow-sm',
                            calculations.yieldWarning
                                ? 'border-amber-200 bg-amber-50'
                                : 'border-gray-200 bg-white'
                        )}>
                            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                                {calculations.yieldWarning && (
                                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                                )}
                                Conversion Summary
                            </h2>

                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-600">Bulk Input:</span>
                                    <span className="font-semibold">{calculations.kgConsumed.toLocaleString()}kg</span>
                                </div>
                                <div className="flex items-center justify-center text-gray-400">
                                    <ArrowRight className="h-5 w-5" />
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-gray-600">Finished Output:</span>
                                    <span className="font-semibold">{calculations.totalFinishedKg.toLocaleString()}kg</span>
                                </div>
                                <div className="border-t pt-3 mt-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-gray-600">Yield:</span>
                                        <span className={clsx(
                                            'font-semibold',
                                            calculations.yieldPercentage > 100 ? 'text-red-600' :
                                                calculations.yieldPercentage < 90 ? 'text-amber-600' :
                                                    'text-green-600'
                                        )}>
                                            {calculations.yieldPercentage.toFixed(1)}%
                                        </span>
                                    </div>
                                </div>

                                {calculations.yieldWarning && (
                                    <div className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
                                        <p className="font-medium">Yield Warning</p>
                                        <p>
                                            {calculations.yieldPercentage > 100
                                                ? 'Output exceeds input - please verify quantities.'
                                                : 'Yield is below 90% - this accounts for waste/loss.'}
                                        </p>
                                    </div>
                                )}

                                {selectedBulkProduct.landed_cost_per_kg > 0 && calculations.totalFinishedKg > 0 && (
                                    <div className="rounded-lg bg-blue-50 p-3 text-sm">
                                        <p className="text-blue-800">
                                            <span className="font-medium">Value Transfer (NZD):</span>{' '}
                                            ${calculations.bulkTotalValue.toFixed(2)} from bulk
                                        </p>
                                        <p className="text-blue-700">
                                            Finished goods will be valued at ${(calculations.bulkTotalValue / calculations.totalFinishedKg).toFixed(2)}/kg
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Submit Button */}
                            <button
                                onClick={handleSubmit}
                                disabled={submitting || finishedGoods.every(fg => fg.quantity <= 0)}
                                className={clsx(
                                    'mt-6 w-full flex items-center justify-center gap-2 rounded-lg px-4 py-3 font-medium transition-colors',
                                    submitting || finishedGoods.every(fg => fg.quantity <= 0)
                                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                        : 'bg-blue-600 text-white hover:bg-blue-700'
                                )}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        Processing...
                                    </>
                                ) : (
                                    <>
                                        <Factory className="h-5 w-5" />
                                        Process Conversion
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Conversion History */}
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
                <div className="border-b border-gray-200 px-6 py-4">
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                        <History className="h-5 w-5 text-gray-500" />
                        Recent Conversions
                    </h2>
                </div>

                {history.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-gray-500">Date</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-gray-500">Bulk Material</th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500">Bags</th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500">Kg</th>
                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase text-gray-500">Finished Goods</th>
                                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase text-gray-500">Value</th>
                                    <th className="px-6 py-3 text-center text-xs font-semibold uppercase text-gray-500">Xero</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {history.map(record => (
                                    <tr key={record.conversion_id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 text-sm text-gray-900">
                                            {new Date(record.conversion_date).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-sm font-mono">
                                                {record.bulk_product_code}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-right text-gray-900">
                                            {record.bags_consumed}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-right text-gray-900">
                                            {record.kg_consumed.toLocaleString()}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-600">
                                            {record.finished_goods.map(fg => (
                                                <span key={fg.product_code} className="mr-2">
                                                    {fg.product_code}: {fg.quantity}
                                                </span>
                                            ))}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-right font-medium text-gray-900">
                                            ${record.bulk_total_value.toFixed(2)}
                                        </td>
                                        <td className="px-6 py-4 text-center">
                                            {(record.xero_credit_note_id || record.xero_invoice_id) && (
                                                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                                                    <CheckCircle2 className="h-4 w-4" />
                                                    Synced
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="px-6 py-12 text-center">
                        <History className="mx-auto h-12 w-12 text-gray-300" />
                        <p className="mt-2 text-sm text-gray-500">No conversions recorded yet</p>
                    </div>
                )}
            </div>
        </div>
    );
}
