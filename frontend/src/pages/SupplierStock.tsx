import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
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
