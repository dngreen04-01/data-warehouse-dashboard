import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Package, Save, Loader2, CheckCircle, Boxes, Pencil, AlertTriangle } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '';

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

interface SupplierProductsResponse {
  clusters: Cluster[];
  wip_products: WIPProduct[];
  week_ending: string;
}

export default function SupplierStock() {
  const { session } = useAuth();
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [wipByCluster, setWipByCluster] = useState<Map<number, WIPProduct[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekEnding, setWeekEnding] = useState<string>('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [hasChanges, setHasChanges] = useState(false);

  // WIP Capacity Edit Modal State
  const [editingWIP, setEditingWIP] = useState<WIPProduct | null>(null);
  const [capacityValue, setCapacityValue] = useState<string>('');
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);

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
        fetch(`${API_BASE}/api/supplier/products`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        }),
        fetch(`${API_BASE}/api/supplier/current-week`, {
          headers: { 'Authorization': `Bearer ${session.access_token}` }
        })
      ]);

      if (!productsRes.ok) throw new Error('Failed to fetch products');
      if (!weekRes.ok) throw new Error('Failed to fetch week info');

      const productsData: SupplierProductsResponse = await productsRes.json();
      const weekData = await weekRes.json();

      // Defensive: ensure arrays are present even if API returns unexpected data
      const clustersData = productsData.clusters ?? [];
      const wipProducts = productsData.wip_products ?? [];

      // Group WIP products by their parent cluster
      const wipMap = new Map<number, WIPProduct[]>();
      wipProducts.forEach((wip) => {
        const existing = wipMap.get(wip.cluster_id) || [];
        existing.push(wip);
        wipMap.set(wip.cluster_id, existing);
      });

      setClusters(clustersData);
      setWipByCluster(wipMap);
      setWeekEnding(weekData.week_ending_formatted);

      // Initialize quantities from existing data (both finished and WIP products)
      const initialQtys: Record<number, string> = {};
      clustersData.forEach((cluster: Cluster) => {
        cluster.products.forEach((product: Product) => {
          initialQtys[product.product_id] = product.current_week_qty?.toString() ?? '';
        });
      });
      wipProducts.forEach((product: WIPProduct) => {
        initialQtys[product.product_id] = product.current_week_qty?.toString() ?? '';
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

      const response = await fetch(`${API_BASE}/api/supplier/stock`, {
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

  // WIP Capacity Edit Handlers
  const openCapacityEdit = (product: WIPProduct) => {
    setEditingWIP(product);
    setCapacityValue(product.production_capacity_per_day?.toString() ?? '');
    setConfirmStep(1);
    setCapacityError(null);
  };

  const closeCapacityEdit = () => {
    setEditingWIP(null);
    setCapacityValue('');
    setConfirmStep(1);
    setCapacityError(null);
  };

  const handleCapacityInputChange = (value: string) => {
    // Allow empty string or valid non-negative integers only
    if (value === '' || /^\d+$/.test(value)) {
      setCapacityValue(value);
      setCapacityError(null);
    }
  };

  const proceedToConfirm = () => {
    if (!capacityValue || capacityValue === '') {
      setCapacityError('Please enter a capacity value');
      return;
    }
    const numValue = parseInt(capacityValue);
    if (isNaN(numValue) || numValue < 0) {
      setCapacityError('Please enter a valid positive integer');
      return;
    }
    setConfirmStep(2);
  };

  const saveCapacity = async () => {
    if (!session?.access_token || !editingWIP) return;

    setSavingCapacity(true);
    setCapacityError(null);

    try {
      const response = await fetch(`${API_BASE}/api/wip-products/${editingWIP.product_id}/capacity`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          production_capacity_per_day: parseInt(capacityValue)
        })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to update capacity');
      }

      // Refresh data and close modal
      await fetchData();
      closeCapacityEdit();
    } catch (err) {
      setCapacityError(err instanceof Error ? err.message : 'Failed to update capacity');
    } finally {
      setSavingCapacity(false);
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
    <div className="space-y-6">
      {/* Header */}
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
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {saveSuccess && (
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
          Stock entries saved successfully!
        </div>
      )}

      {/* Products - Clusters with WIP */}
      <div className="space-y-6">
        {clusters.map((cluster) => {
          const clusterWipProducts = cluster.cluster_id ? wipByCluster.get(cluster.cluster_id) || [] : [];
          return (
            <div key={cluster.cluster_id ?? 'unclustered'} className="bg-white rounded-lg shadow overflow-hidden">
              {/* Cluster Header */}
              <div className="bg-purple-50 px-4 py-3 border-b border-purple-100">
                <h2 className="font-semibold text-purple-900">{cluster.cluster_label}</h2>
                <p className="text-sm text-purple-600">
                  {cluster.products.length} product{cluster.products.length !== 1 ? 's' : ''}
                  {clusterWipProducts.length > 0 && ` + ${clusterWipProducts.length} WIP`}
                </p>
              </div>

              {/* Finished Products Table */}
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

              {/* WIP Products Section (within cluster) */}
              {clusterWipProducts.length > 0 && (
                <>
                  <div className="bg-amber-50 px-4 py-2 border-t border-b border-amber-100 flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-amber-600" />
                    <span className="text-sm font-medium text-amber-800">Work in Progress (Unpacked)</span>
                  </div>
                  <table className="min-w-full">
                    <thead className="bg-amber-50/50">
                      <tr>
                        <th className="px-4 py-2 text-left text-xs font-medium text-amber-700 uppercase tracking-wider w-32">
                          SKU Code
                        </th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-amber-700 uppercase tracking-wider">
                          Title
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-amber-700 uppercase tracking-wider w-32">
                          Capacity/Day
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-amber-700 uppercase tracking-wider w-32">
                          Last Week
                        </th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-amber-700 uppercase tracking-wider w-40">
                          Current Qty
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {clusterWipProducts.map((product) => (
                        <tr key={product.product_id} className="hover:bg-amber-50/30">
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              {product.product_code}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {product.item_name}
                          </td>
                          <td className="px-4 py-3 text-sm text-amber-600 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span>
                                {product.production_capacity_per_day !== null
                                  ? product.production_capacity_per_day.toLocaleString() + '/day'
                                  : '—'}
                              </span>
                              <button
                                onClick={() => openCapacityEdit(product)}
                                className="p-1 text-amber-500 hover:text-amber-700 hover:bg-amber-100 rounded transition-colors"
                                title="Edit capacity"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            </div>
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
                              className="w-24 px-3 py-1.5 text-right border border-amber-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* WIP Capacity Edit Modal */}
      {editingWIP && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            {/* Backdrop */}
            <div
              className="fixed inset-0 bg-black/50 transition-opacity"
              onClick={closeCapacityEdit}
            />

            {/* Modal */}
            <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              {confirmStep === 1 ? (
                // Step 1: Edit Form
                <>
                  <div className="mb-6">
                    <h2 className="text-lg font-semibold text-gray-900">Edit Production Capacity</h2>
                    <p className="text-sm text-gray-500 mt-1">{editingWIP.item_name}</p>
                    <p className="text-xs text-amber-600 font-mono">{editingWIP.product_code}</p>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Production Capacity (units/day)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={capacityValue}
                        onChange={(e) => handleCapacityInputChange(e.target.value)}
                        placeholder="Enter capacity"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
                        autoFocus
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Current: {editingWIP.production_capacity_per_day !== null
                          ? editingWIP.production_capacity_per_day.toLocaleString() + '/day'
                          : 'Not set'}
                      </p>
                    </div>

                    {capacityError && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                        {capacityError}
                      </div>
                    )}
                  </div>

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={closeCapacityEdit}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={proceedToConfirm}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                </>
              ) : (
                // Step 2: Confirmation
                <>
                  <div className="mb-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-amber-100 rounded-full">
                        <AlertTriangle className="h-6 w-6 text-amber-600" />
                      </div>
                      <h2 className="text-lg font-semibold text-gray-900">Confirm Change</h2>
                    </div>
                    <p className="text-sm text-gray-600">
                      This is a major change that will affect production planning. Please confirm you want to proceed.
                    </p>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4 mb-6">
                    <div className="text-sm">
                      <div className="font-medium text-gray-900 mb-2">{editingWIP.item_name}</div>
                      <div className="flex items-center gap-3">
                        <span className="text-gray-500">
                          {editingWIP.production_capacity_per_day !== null
                            ? editingWIP.production_capacity_per_day.toLocaleString() + '/day'
                            : 'Not set'}
                        </span>
                        <span className="text-gray-400">→</span>
                        <span className="font-semibold text-amber-600">
                          {parseInt(capacityValue).toLocaleString()}/day
                        </span>
                      </div>
                    </div>
                  </div>

                  {capacityError && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm mb-4">
                      {capacityError}
                    </div>
                  )}

                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => setConfirmStep(1)}
                      disabled={savingCapacity}
                      className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={saveCapacity}
                      disabled={savingCapacity}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
                    >
                      {savingCapacity && <Loader2 className="h-4 w-4 animate-spin" />}
                      Confirm Change
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
