import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Package, TrendingUp, BarChart3, ChevronUp, ChevronDown, ArrowUpDown, Calendar } from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Bar, Line, ComposedChart, Legend
} from 'recharts';
import { format, subDays } from 'date-fns';
import clsx from 'clsx';

// Types based on the RPCs from Milestone 2
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
    estimated_days_of_stock: number | null;
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

interface TimeSeriesPoint {
    period_date: string;
    total_units_sold: number;
    total_revenue: number;
}

type SortField = 'units_on_hand' | 'units_sold_30d' | 'revenue_30d' | 'unit_multiplier';
type SortDirection = 'asc' | 'desc';

// Helper function to format large numbers
const formatNumber = (num: number, decimals: number = 0): string => {
    if (num === 0) return '0';
    if (Math.abs(num) >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (Math.abs(num) >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString('en-NZ', { maximumFractionDigits: decimals });
};

// Helper function to format currency
const formatCurrency = (num: number): string => {
    if (num === 0) return '$0';
    if (Math.abs(num) >= 1_000_000) {
        return '$' + (num / 1_000_000).toFixed(1) + 'M';
    }
    if (Math.abs(num) >= 1_000) {
        return '$' + (num / 1_000).toFixed(1) + 'K';
    }
    return '$' + num.toLocaleString('en-NZ', { maximumFractionDigits: 0 });
};

export default function ClusterAnalytics() {
    // State for summary data
    const [clusterSummaries, setClusterSummaries] = useState<ProductClusterSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // State for selected cluster details
    const [selectedCluster, setSelectedCluster] = useState<ProductClusterSummary | null>(null);
    const [productDetails, setProductDetails] = useState<ClusterProductDetail[]>([]);
    const [detailsLoading, setDetailsLoading] = useState(false);

    // State for time series chart
    const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesPoint[]>([]);
    const [timeSeriesLoading, setTimeSeriesLoading] = useState(false);
    const [dateRange, setDateRange] = useState({
        start: format(subDays(new Date(), 90), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd')
    });

    // Sorting state for product details table
    const [sortField, setSortField] = useState<SortField>('units_sold_30d');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Fetch cluster summaries on mount
    useEffect(() => {
        fetchClusterSummaries();
    }, []);

    // Fetch product details when a cluster is selected
    useEffect(() => {
        if (selectedCluster) {
            fetchProductDetails(selectedCluster.cluster_id);
            fetchTimeSeries(selectedCluster.cluster_id);
        } else {
            setProductDetails([]);
            setTimeSeriesData([]);
        }
    }, [selectedCluster]);

    // Refetch time series when date range changes
    useEffect(() => {
        if (selectedCluster) {
            fetchTimeSeries(selectedCluster.cluster_id);
        }
    }, [dateRange]);

    const fetchClusterSummaries = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_product_cluster_summary');
            if (rpcError) throw rpcError;
            setClusterSummaries(data || []);
        } catch (err) {
            console.error('Error fetching cluster summaries:', err);
            setError('Failed to load cluster analytics. Please try again.');
            setClusterSummaries([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchProductDetails = async (clusterId: number) => {
        setDetailsLoading(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_cluster_product_details', {
                p_cluster_id: clusterId
            });
            if (rpcError) throw rpcError;
            setProductDetails(data || []);
        } catch (err) {
            console.error('Error fetching product details:', err);
            setProductDetails([]);
        } finally {
            setDetailsLoading(false);
        }
    };

    const fetchTimeSeries = async (clusterId: number) => {
        setTimeSeriesLoading(true);
        try {
            const { data, error: rpcError } = await supabase.rpc('get_cluster_sales_timeseries', {
                p_cluster_id: clusterId,
                p_start_date: dateRange.start,
                p_end_date: dateRange.end
            });
            if (rpcError) throw rpcError;
            // Format the data for the chart
            const formattedData = (data || []).map((point: TimeSeriesPoint) => ({
                ...point,
                date: format(new Date(point.period_date), 'MMM d'),
                total_units_sold: Number(point.total_units_sold) || 0,
                total_revenue: Number(point.total_revenue) || 0
            }));
            setTimeSeriesData(formattedData);
        } catch (err) {
            console.error('Error fetching time series:', err);
            setTimeSeriesData([]);
        } finally {
            setTimeSeriesLoading(false);
        }
    };

    // Sort product details
    const sortedProductDetails = useMemo(() => {
        return [...productDetails].sort((a, b) => {
            const aVal = a[sortField] || 0;
            const bVal = b[sortField] || 0;
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        });
    }, [productDetails, sortField, sortDirection]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return <ArrowUpDown className="h-3.5 w-3.5 text-gray-400" />;
        return sortDirection === 'asc'
            ? <ChevronUp className="h-3.5 w-3.5 text-blue-600" />
            : <ChevronDown className="h-3.5 w-3.5 text-blue-600" />;
    };

    // Custom tooltip for chart
    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            const baseUnit = selectedCluster?.base_unit_label || 'units';
            return (
                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200">
                    <p className="text-sm font-medium text-gray-900 mb-2">{label}</p>
                    <p className="text-sm text-blue-600">
                        {formatNumber(payload[0]?.value || 0)} {baseUnit} sold
                    </p>
                    <p className="text-sm text-green-600">
                        {formatCurrency(payload[1]?.value || 0)} revenue
                    </p>
                </div>
            );
        }
        return null;
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="text-center py-20">
                <Package className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                <p className="text-red-600 font-medium">{error}</p>
                <button
                    onClick={fetchClusterSummaries}
                    className="mt-4 px-4 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
                >
                    Try Again
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">Cluster Analytics</h1>
                <p className="text-sm text-gray-500">
                    Production planning insights with unit multiplier aggregation
                </p>
            </div>

            {/* Summary Cards Grid */}
            <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Product Clusters Overview</h2>
                {clusterSummaries.length === 0 ? (
                    <div className="text-center py-12 rounded-xl border bg-white">
                        <Package className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                        <p className="text-gray-500 font-medium">No product clusters found</p>
                        <p className="text-sm text-gray-400 mt-1">
                            Create product clusters in the Cluster Management page
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {clusterSummaries.map(cluster => (
                            <div
                                key={cluster.cluster_id}
                                onClick={() => setSelectedCluster(
                                    selectedCluster?.cluster_id === cluster.cluster_id ? null : cluster
                                )}
                                className={clsx(
                                    "rounded-xl border bg-white p-5 shadow-sm cursor-pointer transition-all duration-200 hover:shadow-md",
                                    selectedCluster?.cluster_id === cluster.cluster_id
                                        ? "ring-2 ring-blue-500 border-blue-200"
                                        : "hover:border-blue-200"
                                )}
                            >
                                <div className="flex items-start justify-between mb-4">
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{cluster.cluster_label}</h3>
                                        <p className="text-xs text-gray-500">
                                            {cluster.product_count} products · {cluster.base_unit_label || 'units'}
                                        </p>
                                    </div>
                                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                                        <Package className="h-5 w-5 text-blue-600" />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Units On Hand</p>
                                        <p className="text-lg font-bold text-gray-900">
                                            {formatNumber(cluster.total_units_on_hand)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Sold (30d)</p>
                                        <p className="text-lg font-bold text-gray-900">
                                            {formatNumber(cluster.total_units_sold_30d)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Revenue (30d)</p>
                                        <p className="text-lg font-bold text-green-600">
                                            {formatCurrency(cluster.total_revenue_30d)}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">Days of Stock</p>
                                        <p className={clsx(
                                            "text-lg font-bold",
                                            cluster.estimated_days_of_stock === null
                                                ? "text-gray-400"
                                                : cluster.estimated_days_of_stock < 30
                                                    ? "text-red-600"
                                                    : cluster.estimated_days_of_stock < 90
                                                        ? "text-amber-600"
                                                        : "text-green-600"
                                        )}>
                                            {cluster.estimated_days_of_stock === null
                                                ? '—'
                                                : Math.round(cluster.estimated_days_of_stock)}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Selected Cluster Details */}
            {selectedCluster && (
                <div className="space-y-6">
                    {/* Time Series Chart */}
                    <div className="rounded-xl border bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    {selectedCluster.cluster_label} - Sales Trend
                                </h2>
                                <p className="text-sm text-gray-500">
                                    Daily {selectedCluster.base_unit_label || 'units'} sold and revenue
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-gray-400" />
                                <input
                                    type="date"
                                    value={dateRange.start}
                                    onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                                <span className="text-gray-400">to</span>
                                <input
                                    type="date"
                                    value={dateRange.end}
                                    onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {timeSeriesLoading ? (
                            <div className="flex items-center justify-center py-16">
                                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                            </div>
                        ) : timeSeriesData.length === 0 ? (
                            <div className="text-center py-16 text-gray-500">
                                <BarChart3 className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                                <p className="text-sm">No sales data for this period</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <ComposedChart data={timeSeriesData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                    <XAxis
                                        dataKey="date"
                                        tick={{ fontSize: 12, fill: '#6b7280' }}
                                        tickLine={false}
                                        axisLine={{ stroke: '#e5e7eb' }}
                                    />
                                    <YAxis
                                        yAxisId="left"
                                        tick={{ fontSize: 12, fill: '#6b7280' }}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => formatNumber(value)}
                                    />
                                    <YAxis
                                        yAxisId="right"
                                        orientation="right"
                                        tick={{ fontSize: 12, fill: '#6b7280' }}
                                        tickLine={false}
                                        axisLine={false}
                                        tickFormatter={(value) => formatCurrency(value)}
                                    />
                                    <Tooltip content={<CustomTooltip />} />
                                    <Legend />
                                    <Bar
                                        yAxisId="left"
                                        dataKey="total_units_sold"
                                        name={`${selectedCluster.base_unit_label || 'Units'} Sold`}
                                        fill="#3b82f6"
                                        radius={[4, 4, 0, 0]}
                                    />
                                    <Line
                                        yAxisId="right"
                                        type="monotone"
                                        dataKey="total_revenue"
                                        name="Revenue"
                                        stroke="#10b981"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                </ComposedChart>
                            </ResponsiveContainer>
                        )}
                    </div>

                    {/* Product Details Table */}
                    <div className="rounded-xl border bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">
                                    Products in {selectedCluster.cluster_label}
                                </h2>
                                <p className="text-sm text-gray-500">
                                    {productDetails.length} products with unit multiplier breakdown
                                </p>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                <TrendingUp className="h-4 w-4" />
                                <span>
                                    Total: {formatNumber(
                                        productDetails.reduce((sum, p) => sum + (p.units_sold_30d || 0), 0)
                                    )} {selectedCluster.base_unit_label || 'units'} sold (30d)
                                </span>
                            </div>
                        </div>

                        {detailsLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                            </div>
                        ) : productDetails.length === 0 ? (
                            <div className="text-center py-12 text-gray-500">
                                <Package className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                                <p className="text-sm">No products in this cluster</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Product
                                            </th>
                                            <th
                                                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                                onClick={() => handleSort('unit_multiplier')}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Multiplier
                                                    <SortIcon field="unit_multiplier" />
                                                </div>
                                            </th>
                                            <th
                                                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                                onClick={() => handleSort('units_on_hand')}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Units On Hand
                                                    <SortIcon field="units_on_hand" />
                                                </div>
                                            </th>
                                            <th
                                                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                                onClick={() => handleSort('units_sold_30d')}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Units Sold (30d)
                                                    <SortIcon field="units_sold_30d" />
                                                </div>
                                            </th>
                                            <th
                                                className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                                                onClick={() => handleSort('revenue_30d')}
                                            >
                                                <div className="flex items-center justify-end gap-1">
                                                    Revenue (30d)
                                                    <SortIcon field="revenue_30d" />
                                                </div>
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {sortedProductDetails.map(product => (
                                            <tr key={product.product_id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {product.item_name}
                                                        </p>
                                                        <p className="text-xs text-gray-500">
                                                            {product.product_code}
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                                    <span className="text-sm text-gray-600">
                                                        ×{product.unit_multiplier.toLocaleString('en-NZ')}
                                                    </span>
                                                    <span className="text-xs text-gray-400 ml-1">
                                                        {selectedCluster.base_unit_label || 'units'}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {formatNumber(product.units_on_hand)}
                                                        </p>
                                                        <p className="text-xs text-gray-400">
                                                            ({product.quantity_on_hand} pcs)
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-900">
                                                            {formatNumber(product.units_sold_30d)}
                                                        </p>
                                                        <p className="text-xs text-gray-400">
                                                            ({product.qty_sold_30d} pcs)
                                                        </p>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                                    <p className="text-sm font-medium text-green-600">
                                                        {formatCurrency(product.revenue_30d)}
                                                    </p>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot className="bg-gray-50">
                                        <tr>
                                            <td className="px-6 py-3 text-sm font-semibold text-gray-900">
                                                Total
                                            </td>
                                            <td className="px-6 py-3"></td>
                                            <td className="px-6 py-3 text-right text-sm font-semibold text-gray-900">
                                                {formatNumber(
                                                    productDetails.reduce((sum, p) => sum + (p.units_on_hand || 0), 0)
                                                )}
                                            </td>
                                            <td className="px-6 py-3 text-right text-sm font-semibold text-gray-900">
                                                {formatNumber(
                                                    productDetails.reduce((sum, p) => sum + (p.units_sold_30d || 0), 0)
                                                )}
                                            </td>
                                            <td className="px-6 py-3 text-right text-sm font-semibold text-green-600">
                                                {formatCurrency(
                                                    productDetails.reduce((sum, p) => sum + (p.revenue_30d || 0), 0)
                                                )}
                                            </td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
