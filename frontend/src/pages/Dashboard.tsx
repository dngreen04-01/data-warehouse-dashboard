import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, TrendingUp, TrendingDown, DollarSign, Package, Filter, ChevronUp, ChevronDown, ArrowUpDown, Download, Image, AlertCircle, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    Bar, Legend, ComposedChart, Line
} from 'recharts';
import { format, startOfYear, endOfDay, subWeeks, startOfWeek, endOfWeek, startOfMonth, differenceInDays } from 'date-fns';
import html2canvas from 'html2canvas';

type ComparisonPeriod = 'last_year' | 'last_last_year';
type SortField = 'revenue' | 'ly_pct_change' | 'ly_delta';
type SortDirection = 'asc' | 'desc';
type ChartGranularity = 'day' | 'week' | 'month';

interface BreakdownItem {
    label: string;
    revenue: number;
    ly_revenue: number;
    lly_revenue: number;
    ly_delta: number;
    lly_delta: number;
    ly_pct_change: number;
    lly_pct_change: number;
}

const PAGE_SIZE = 50;

export default function Dashboard() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [comparisonChartData, setComparisonChartData] = useState<any[]>([]);
    const [metrics, setMetrics] = useState<any>({});
    const [metricsLLY, setMetricsLLY] = useState<any>({});
    const [breakdown, setBreakdown] = useState<BreakdownItem[]>([]);
    const [granularity, setGranularity] = useState<ChartGranularity>('month');
    const [currentPage, setCurrentPage] = useState(1);

    // Filters
    const [dateRange, setDateRange] = useState({
        start: format(startOfYear(new Date()), 'yyyy-01-01'),
        end: format(endOfDay(new Date()), 'yyyy-MM-dd'),
    });
    const [filters, setFilters] = useState({
        merchant_group: [] as string[],
        product_group: [] as string[],
        market: [] as string[],
        customer_cluster: [] as string[],
        product_cluster: [] as string[]
    });
    const [selectedPreset, setSelectedPreset] = useState('year_to_date');
    const [options, setOptions] = useState<any>({});
    const [breakdownDim, setBreakdownDim] = useState('product');
    const [showFilters, setShowFilters] = useState(false);

    // Comparison period selector (Last Year or Last Last Year)
    const [comparisonPeriod, setComparisonPeriod] = useState<ComparisonPeriod>('last_year');

    // Chart display options
    const [showCumulative, setShowCumulative] = useState(false);

    // Sorting state for Top Performers
    const [sortField, setSortField] = useState<SortField>('revenue');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

    // Ref for chart export
    const chartRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        fetchOptions();
    }, []);

    useEffect(() => {
        fetchData();
    }, [dateRange, filters, breakdownDim, comparisonPeriod]);

    const fetchOptions = async () => {
        const { data } = await supabase.rpc('get_filter_options');
        if (data) setOptions(data);
    };

    const getShiftedDateRange = (yearsBack: number) => {
        const startDate = new Date(dateRange.start);
        const endDate = new Date(dateRange.end);
        startDate.setFullYear(startDate.getFullYear() - yearsBack);
        endDate.setFullYear(endDate.getFullYear() - yearsBack);
        return {
            start: format(startDate, 'yyyy-MM-dd'),
            end: format(endDate, 'yyyy-MM-dd')
        };
    };

    const applyPreset = (preset: string) => {
        const today = new Date();
        let start = new Date();
        let end = new Date();

        switch (preset) {
            case 'last_week':
                // Last week (Monday - Sunday)
                const lastWeek = subWeeks(today, 1);
                start = startOfWeek(lastWeek, { weekStartsOn: 1 });
                end = endOfWeek(lastWeek, { weekStartsOn: 1 });
                break;
            case 'month_to_date':
                start = startOfMonth(today);
                end = today;
                break;
            case 'year_to_date':
                start = startOfYear(today);
                end = today;
                break;
            case 'custom':
                return; // Do nothing for custom
            default:
                break;
        }

        setDateRange({
            start: format(start, 'yyyy-MM-dd'),
            end: format(end, 'yyyy-MM-dd')
        });
        setSelectedPreset(preset);
    };

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const rpcParams = {
                p_start_date: dateRange.start,
                p_end_date: dateRange.end,
                p_merchant_group: filters.merchant_group.length ? filters.merchant_group : null,
                p_product_group: filters.product_group.length ? filters.product_group : null,
                p_market: filters.market.length ? filters.market : null,
                p_cluster: filters.customer_cluster.length ? filters.customer_cluster : null,
                p_product_cluster: filters.product_cluster.length ? filters.product_cluster : null,
            };

            // Determine granularity based on date range duration
            const diffDays = differenceInDays(new Date(dateRange.end), new Date(dateRange.start));
            let newGranularity: ChartGranularity = 'month';
            if (diffDays <= 14) {
                newGranularity = 'day';
            } else if (diffDays <= 60) {
                newGranularity = 'week';
            }
            setGranularity(newGranularity);


            // 1. Sales Overview (Current Period)
            const { data: currentData } = await supabase.rpc('get_sales_overview', rpcParams);

            // 1b. Sales Overview (Last Year)
            const lyDateRange = getShiftedDateRange(1);
            const { data: lyData } = await supabase.rpc('get_sales_overview', {
                ...rpcParams,
                p_start_date: lyDateRange.start,
                p_end_date: lyDateRange.end,
            });

            // 1c. Sales Overview (Last Last Year)
            const llyDateRange = getShiftedDateRange(2);
            const { data: llyData } = await supabase.rpc('get_sales_overview', {
                ...rpcParams,
                p_start_date: llyDateRange.start,
                p_end_date: llyDateRange.end,
            });

            // 2. YoY Metrics (Last Year)
            const { data: yoyData } = await supabase.rpc('get_yoy_comparison', rpcParams);
            setMetrics(yoyData?.[0] || {});

            // 2b. YoY Metrics (Last Last Year)
            const { data: llyMetricsData } = await supabase.rpc('get_yoy_comparison', {
                ...rpcParams,
                p_start_date: lyDateRange.start,
                p_end_date: lyDateRange.end,
            });
            const currentRevenue = yoyData?.[0]?.current_revenue || 0;
            const currentQty = yoyData?.[0]?.current_qty || 0;
            const llyRevenue = llyMetricsData?.[0]?.previous_revenue || 0;
            const llyQty = llyMetricsData?.[0]?.previous_qty || 0;
            setMetricsLLY({
                current_revenue: currentRevenue,
                previous_revenue: llyRevenue,
                current_qty: currentQty,
                previous_qty: llyQty
            });

            // 3. Build comparison chart data with dynamic granularity
            const chartMap = new Map();

            const getChartKey = (dateStr: string, gran: ChartGranularity) => {
                const d = new Date(dateStr);
                if (gran === 'day') return format(d, 'yyyy-MM-dd');
                if (gran === 'week') return format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');
                return format(startOfMonth(d), 'yyyy-MM-01');
            };

            (currentData || []).forEach((item: any) => {
                const key = getChartKey(item.invoice_date, newGranularity);
                if (!chartMap.has(key)) {
                    chartMap.set(key, { date_key: key, current_revenue: 0, ly_revenue: 0, lly_revenue: 0 });
                }
                chartMap.get(key).current_revenue += item.revenue || 0;
            });

            (lyData || []).forEach((item: any) => {
                const d = new Date(item.invoice_date);
                d.setFullYear(d.getFullYear() + 1);
                // Adjust for week alignment if needed, but simple year shift usually suffices for visual comparison
                // For strict day-of-week alignment we might need more complex logic, but date-based shift is standard here.

                const key = getChartKey(format(d, 'yyyy-MM-dd'), newGranularity);

                if (!chartMap.has(key)) {
                    chartMap.set(key, { date_key: key, current_revenue: 0, ly_revenue: 0, lly_revenue: 0 });
                }
                chartMap.get(key).ly_revenue += item.revenue || 0;
            });

            (llyData || []).forEach((item: any) => {
                const d = new Date(item.invoice_date);
                d.setFullYear(d.getFullYear() + 2);

                const key = getChartKey(format(d, 'yyyy-MM-dd'), newGranularity);

                if (!chartMap.has(key)) {
                    chartMap.set(key, { date_key: key, current_revenue: 0, ly_revenue: 0, lly_revenue: 0 });
                }
                chartMap.get(key).lly_revenue += item.revenue || 0;
            });

            setComparisonChartData(Array.from(chartMap.values()).sort((a, b) => a.date_key.localeCompare(b.date_key)));

            // 4. Breakdown - Fetch for current, LY, and LLY periods
            const [currentBreakdown, lyBreakdown, llyBreakdown] = await Promise.all([
                supabase.rpc('get_breakdown', {
                    ...rpcParams,
                    p_dimension: breakdownDim,
                    p_limit: 500
                }),
                supabase.rpc('get_breakdown', {
                    p_start_date: lyDateRange.start,
                    p_end_date: lyDateRange.end,
                    p_merchant_group: filters.merchant_group.length ? filters.merchant_group : null,
                    p_product_group: filters.product_group.length ? filters.product_group : null,
                    p_market: filters.market.length ? filters.market : null,
                    p_cluster: filters.customer_cluster.length ? filters.customer_cluster : null,
                    p_product_cluster: filters.product_cluster.length ? filters.product_cluster : null,
                    p_dimension: breakdownDim,
                    p_limit: 500
                }),
                supabase.rpc('get_breakdown', {
                    p_start_date: llyDateRange.start,
                    p_end_date: llyDateRange.end,
                    p_merchant_group: filters.merchant_group.length ? filters.merchant_group : null,
                    p_product_group: filters.product_group.length ? filters.product_group : null,
                    p_market: filters.market.length ? filters.market : null,
                    p_cluster: filters.customer_cluster.length ? filters.customer_cluster : null,
                    p_product_cluster: filters.product_cluster.length ? filters.product_cluster : null,
                    p_dimension: breakdownDim,
                    p_limit: 500
                })
            ]);

            // Merge breakdown data
            const breakdownMap = new Map<string, BreakdownItem>();

            (currentBreakdown.data || []).forEach((item: any) => {
                breakdownMap.set(item.label, {
                    label: item.label,
                    revenue: item.revenue || 0,
                    ly_revenue: 0,
                    lly_revenue: 0,
                    ly_delta: 0,
                    lly_delta: 0,
                    ly_pct_change: 0,
                    lly_pct_change: 0
                });
            });

            (lyBreakdown.data || []).forEach((item: any) => {
                if (breakdownMap.has(item.label)) {
                    breakdownMap.get(item.label)!.ly_revenue = item.revenue || 0;
                } else {
                    breakdownMap.set(item.label, {
                        label: item.label,
                        revenue: 0,
                        ly_revenue: item.revenue || 0,
                        lly_revenue: 0,
                        ly_delta: 0,
                        lly_delta: 0,
                        ly_pct_change: 0,
                        lly_pct_change: 0
                    });
                }
            });

            (llyBreakdown.data || []).forEach((item: any) => {
                if (breakdownMap.has(item.label)) {
                    breakdownMap.get(item.label)!.lly_revenue = item.revenue || 0;
                } else {
                    breakdownMap.set(item.label, {
                        label: item.label,
                        revenue: 0,
                        ly_revenue: 0,
                        lly_revenue: item.revenue || 0,
                        ly_delta: 0,
                        lly_delta: 0,
                        ly_pct_change: 0,
                        lly_pct_change: 0
                    });
                }
            });

            // Calculate deltas and percentages
            breakdownMap.forEach((item) => {
                item.ly_delta = item.revenue - item.ly_revenue;
                item.lly_delta = item.revenue - item.lly_revenue;
                item.ly_pct_change = item.ly_revenue > 0 ? ((item.ly_delta / item.ly_revenue) * 100) : (item.revenue > 0 ? 100 : 0);
                item.lly_pct_change = item.lly_revenue > 0 ? ((item.lly_delta / item.lly_revenue) * 100) : (item.revenue > 0 ? 100 : 0);
            });

            setBreakdown(Array.from(breakdownMap.values()));

        } catch (err) {
            console.error('Error fetching dashboard data:', err);
            setError(err instanceof Error ? err.message : 'Failed to load dashboard data. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const toggleFilter = (type: string, value: string) => {
        setFilters(prev => {
            const current = (prev as any)[type];
            const updated = current.includes(value)
                ? current.filter((item: string) => item !== value)
                : [...current, value];
            return { ...prev, [type]: updated };
        });
    };

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
    const formatNumber = (val: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val);
    const formatDelta = (val: number) => `${val >= 0 ? '+' : ''}${formatCurrency(val)}`;
    const formatPct = (val: number) => `${val >= 0 ? '+' : ''}${val.toFixed(0)}%`;

    // Reset page when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [breakdown, sortField, sortDirection]);

    // Sorted breakdown data
    const sortedBreakdown = useMemo(() => {
        return [...breakdown].sort((a, b) => {
            const multiplier = sortDirection === 'desc' ? -1 : 1;
            return multiplier * (a[sortField] - b[sortField]);
        });
    }, [breakdown, sortField, sortDirection]);

    // Paginated breakdown data
    const totalPages = Math.ceil(sortedBreakdown.length / PAGE_SIZE);
    const paginatedBreakdown = useMemo(() => {
        const start = (currentPage - 1) * PAGE_SIZE;
        return sortedBreakdown.slice(start, start + PAGE_SIZE);
    }, [sortedBreakdown, currentPage]);

    // Export table to CSV
    const exportTableToCSV = useCallback(() => {
        const headers = ['Name', 'Current', 'LY', 'vs LY %', 'vs LY $', 'LLY', 'vs LLY %', 'vs LLY $'];
        const rows = sortedBreakdown.map(item => [
            item.label,
            item.revenue.toFixed(0),
            item.ly_revenue.toFixed(0),
            `${item.ly_pct_change.toFixed(1)}%`,
            item.ly_delta.toFixed(0),
            item.lly_revenue.toFixed(0),
            `${item.lly_pct_change.toFixed(1)}%`,
            item.lly_delta.toFixed(0)
        ]);

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `sales_performance_${breakdownDim}_${dateRange.start}_to_${dateRange.end}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }, [sortedBreakdown, breakdownDim, dateRange]);

    // Export chart to PNG using html2canvas
    const exportChartToImage = useCallback(async () => {
        if (!chartRef.current) return;

        try {
            const canvas = await html2canvas(chartRef.current, {
                backgroundColor: '#ffffff',
                scale: 2, // Higher resolution
                logging: false,
                useCORS: true,
            });

            // Download
            const link = document.createElement('a');
            link.download = `revenue_chart_${dateRange.start}_to_${dateRange.end}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        } catch (error) {
            console.error('Error exporting chart:', error);
        }
    }, [dateRange]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
        } else {
            setSortField(field);
            setSortDirection('desc');
        }
    };

    const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
        <button
            onClick={() => handleSort(field)}
            className="flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900 transition-colors"
        >
            {label}
            {sortField === field ? (
                sortDirection === 'desc' ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />
            ) : (
                <ArrowUpDown className="h-3 w-3 text-gray-400" />
            )}
        </button>
    );

    return (
        <div className="space-y-8">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Sales Dashboard</h1>
                    <p className="text-sm text-gray-500">Performance Overview & Trends</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700'}`}
                    >
                        <Filter className="h-4 w-4" />
                        Filters
                    </button>
                    <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2">
                        <select
                            value={selectedPreset}
                            onChange={(e) => applyPreset(e.target.value)}
                            className="border-none bg-transparent p-0 text-sm font-medium text-gray-700 focus:ring-0 cursor-pointer mr-2"
                        >
                            <option value="last_week">Last Week</option>
                            <option value="month_to_date">Month to Date</option>
                            <option value="year_to_date">Year to Date</option>
                            <option value="custom">Custom</option>
                        </select>
                        <div className="h-4 w-px bg-gray-300 mx-1"></div>
                        <input
                            type="date"
                            value={dateRange.start}
                            onChange={(e) => {
                                setDateRange(prev => ({ ...prev, start: e.target.value }));
                                setSelectedPreset('custom');
                            }}
                            className="border-none p-0 text-sm focus:ring-0"
                        />
                        <span className="text-gray-400">-</span>
                        <input
                            type="date"
                            value={dateRange.end}
                            onChange={(e) => {
                                setDateRange(prev => ({ ...prev, end: e.target.value }));
                                setSelectedPreset('custom');
                            }}
                            className="border-none p-0 text-sm focus:ring-0"
                        />
                    </div>
                </div>
            </div>

            {/* Filter Panel */}
            {showFilters && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900">Active Filters</h3>
                        <button onClick={() => setFilters({ merchant_group: [], product_group: [], market: [], customer_cluster: [], product_cluster: [] })} className="text-sm text-red-600 hover:underline">
                            Clear All
                        </button>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
                        <FilterGroup title="Market" options={options.markets} selected={filters.market} onToggle={(v: string) => toggleFilter('market', v)} />
                        <FilterGroup title="Product" options={options.product_groups} selected={filters.product_group} onToggle={(v: string) => toggleFilter('product_group', v)} />
                        <FilterGroup title="Merchant Group" options={options.merchant_groups} selected={filters.merchant_group} onToggle={(v: string) => toggleFilter('merchant_group', v)} />
                        <FilterGroup title="Customer Cluster" options={options.customer_clusters || options.clusters} selected={filters.customer_cluster} onToggle={(v: string) => toggleFilter('customer_cluster', v)} />
                        <FilterGroup title="Product Cluster" options={options.product_clusters} selected={filters.product_cluster} onToggle={(v: string) => toggleFilter('product_cluster', v)} />
                    </div>
                </div>
            )}

            {/* Error Banner */}
            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm" role="alert">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="h-5 w-5 text-red-600" />
                            <div>
                                <p className="font-medium text-red-800">Failed to load dashboard data</p>
                                <p className="text-sm text-red-600">{error}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => fetchData()}
                            className="flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200 transition-colors"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Retry
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex h-96 items-center justify-center">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                </div>
            ) : error ? null : (
                <>
                    {/* KPIs */}
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        {/* Revenue KPI */}
                        <div className="rounded-xl border bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between pb-2">
                                <span className="text-sm font-medium text-gray-500">Total Revenue</span>
                                <DollarSign className="h-4 w-4 text-gray-500" />
                            </div>
                            <div className="text-2xl font-bold">{formatCurrency(metrics.current_revenue || 0)}</div>
                            <div className="mt-3 space-y-1">
                                <ComparisonBadge
                                    label="vs LY"
                                    current={metrics.current_revenue || 0}
                                    previous={metrics.previous_revenue || 0}
                                    formatValue={formatCurrency}
                                />
                                <ComparisonBadge
                                    label="vs LLY"
                                    current={metricsLLY.current_revenue || 0}
                                    previous={metricsLLY.previous_revenue || 0}
                                    formatValue={formatCurrency}
                                />
                            </div>
                        </div>

                        {/* Units KPI */}
                        <div className="rounded-xl border bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between pb-2">
                                <span className="text-sm font-medium text-gray-500">Total Units</span>
                                <Package className="h-4 w-4 text-gray-500" />
                            </div>
                            <div className="text-2xl font-bold">{formatNumber(metrics.current_qty || 0)}</div>
                            <div className="mt-3 space-y-1">
                                <ComparisonBadge
                                    label="vs LY"
                                    current={metrics.current_qty || 0}
                                    previous={metrics.previous_qty || 0}
                                    formatValue={formatNumber}
                                />
                                <ComparisonBadge
                                    label="vs LLY"
                                    current={metricsLLY.current_qty || 0}
                                    previous={metricsLLY.previous_qty || 0}
                                    formatValue={formatNumber}
                                />
                            </div>
                        </div>

                        {/* Avg Order Value */}
                        <div className="rounded-xl border bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between pb-2">
                                <span className="text-sm font-medium text-gray-500">Avg Order Value</span>
                                <DollarSign className="h-4 w-4 text-gray-500" />
                            </div>
                            {(() => {
                                const currentAOV = (metrics.current_qty || 0) > 0
                                    ? (metrics.current_revenue || 0) / (metrics.current_qty || 1)
                                    : 0;
                                const lyAOV = (metrics.previous_qty || 0) > 0
                                    ? (metrics.previous_revenue || 0) / (metrics.previous_qty || 1)
                                    : 0;
                                const llyAOV = (metricsLLY.previous_qty || 0) > 0
                                    ? (metricsLLY.previous_revenue || 0) / (metricsLLY.previous_qty || 1)
                                    : 0;
                                return (
                                    <>
                                        <div className="text-2xl font-bold">{formatCurrency(currentAOV)}</div>
                                        <div className="mt-3 space-y-1">
                                            <ComparisonBadge
                                                label="vs LY"
                                                current={currentAOV}
                                                previous={lyAOV}
                                                formatValue={formatCurrency}
                                            />
                                            <ComparisonBadge
                                                label="vs LLY"
                                                current={currentAOV}
                                                previous={llyAOV}
                                                formatValue={formatCurrency}
                                            />
                                        </div>
                                    </>
                                );
                            })()}
                        </div>

                        {/* Growth Rate */}
                        <div className="rounded-xl border bg-white p-6 shadow-sm">
                            <div className="flex items-center justify-between pb-2">
                                <span className="text-sm font-medium text-gray-500">YoY Growth</span>
                                {(() => {
                                    const growth = (metrics.previous_revenue || 0) > 0
                                        ? ((metrics.current_revenue - metrics.previous_revenue) / metrics.previous_revenue) * 100
                                        : 0;
                                    return growth >= 0
                                        ? <TrendingUp className="h-4 w-4 text-green-500" />
                                        : <TrendingDown className="h-4 w-4 text-red-500" />;
                                })()}
                            </div>
                            {(() => {
                                const lyGrowth = (metrics.previous_revenue || 0) > 0
                                    ? ((metrics.current_revenue - metrics.previous_revenue) / metrics.previous_revenue) * 100
                                    : 0;
                                const llyGrowth = (metricsLLY.previous_revenue || 0) > 0
                                    ? ((metricsLLY.current_revenue - metricsLLY.previous_revenue) / metricsLLY.previous_revenue) * 100
                                    : 0;
                                return (
                                    <>
                                        <div className={`text-2xl font-bold ${lyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {lyGrowth >= 0 ? '+' : ''}{lyGrowth.toFixed(1)}%
                                        </div>
                                        <div className="mt-3 space-y-1">
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-gray-500">vs LY</span>
                                                <span className={lyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                    {formatDelta(metrics.current_revenue - metrics.previous_revenue)}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-gray-500">vs LLY</span>
                                                <span className={llyGrowth >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                    {llyGrowth >= 0 ? '+' : ''}{llyGrowth.toFixed(1)}% ({formatDelta(metricsLLY.current_revenue - metricsLLY.previous_revenue)})
                                                </span>
                                            </div>
                                        </div>
                                    </>
                                );
                            })()}
                        </div>
                    </div>

                    {/* Charts Row 1: Revenue vs Period */}
                    <div className="grid gap-6 lg:grid-cols-1">
                        <div className="rounded-xl border bg-white p-6 shadow-sm">
                            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-lg font-semibold text-gray-900">
                                        Revenue vs. {comparisonPeriod === 'last_year' ? 'Last Year' : 'Last Last Year'} {showCumulative && '(Cumulative)'}
                                    </h3>
                                    <button
                                        onClick={exportChartToImage}
                                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors"
                                        title="Download chart as PNG"
                                    >
                                        <Image className="h-3.5 w-3.5" />
                                        Export
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-3">
                                    {/* Monthly / Cumulative Toggle */}
                                    <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
                                        <button
                                            onClick={() => setShowCumulative(false)}
                                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${!showCumulative
                                                ? 'bg-white text-gray-900 shadow-sm'
                                                : 'text-gray-600 hover:text-gray-900'
                                                }`}
                                        >
                                            Monthly
                                        </button>
                                        <button
                                            onClick={() => setShowCumulative(true)}
                                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${showCumulative
                                                ? 'bg-white text-gray-900 shadow-sm'
                                                : 'text-gray-600 hover:text-gray-900'
                                                }`}
                                        >
                                            Cumulative
                                        </button>
                                    </div>
                                    {/* Comparison Period Selector */}
                                    <div className="flex items-center gap-2">
                                        <label htmlFor="comparison-select" className="text-sm font-medium text-gray-600">
                                            Compare to:
                                        </label>
                                        <select
                                            id="comparison-select"
                                            value={comparisonPeriod}
                                            onChange={(e) => setComparisonPeriod(e.target.value as ComparisonPeriod)}
                                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        >
                                            <option value="last_year">Last Year</option>
                                            <option value="last_last_year">Last Last Year</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div ref={chartRef} className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={(() => {
                                        if (!showCumulative) return comparisonChartData;

                                        let cumCurrent = 0;
                                        let cumLY = 0;
                                        let cumLLY = 0;

                                        return comparisonChartData.map((item: any) => {
                                            cumCurrent += item.current_revenue || 0;
                                            cumLY += item.ly_revenue || 0;
                                            cumLLY += item.lly_revenue || 0;
                                            return {
                                                ...item,
                                                current_revenue: cumCurrent,
                                                ly_revenue: cumLY,
                                                lly_revenue: cumLLY
                                            };
                                        });
                                    })()}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis
                                            dataKey="date_key"
                                            tickFormatter={(t) => {
                                                const d = new Date(t);
                                                if (granularity === 'day') return format(d, 'd MMM');
                                                if (granularity === 'week') return format(d, 'd MMM');
                                                return format(d, 'MMM yy');
                                            }}
                                            fontSize={12}
                                            tickLine={false}
                                            axisLine={false}
                                        />
                                        <YAxis tickFormatter={(v) => `$${v / 1000}k`} fontSize={12} tickLine={false} axisLine={false} />
                                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                                        <Legend />
                                        <Bar dataKey="current_revenue" name="Current" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={20} />
                                        <Line
                                            type="monotone"
                                            dataKey={comparisonPeriod === 'last_year' ? 'ly_revenue' : 'lly_revenue'}
                                            name={comparisonPeriod === 'last_year' ? 'Last Year' : 'Last Last Year'}
                                            stroke="#ef4444"
                                            strokeWidth={2}
                                            dot={false}
                                        />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    {/* Performance Table */}
                    <div className="rounded-xl border bg-white shadow-sm">
                        <div className="border-b border-gray-200 p-6">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-3">
                                    <h3 className="text-lg font-semibold text-gray-900">Performance by {
                                        breakdownDim === 'product_cluster' ? 'Product Cluster' :
                                            breakdownDim === 'customer_cluster' ? 'Customer Cluster' :
                                                breakdownDim === 'merchant_group' ? 'Merchant' :
                                                    breakdownDim.charAt(0).toUpperCase() + breakdownDim.slice(1)
                                    }</h3>
                                    <button
                                        onClick={exportTableToCSV}
                                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors"
                                        title="Export table to CSV"
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Export CSV
                                    </button>
                                </div>
                                <div className="flex items-center gap-3">
                                    <select
                                        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        value={breakdownDim}
                                        onChange={(e) => setBreakdownDim(e.target.value)}
                                    >
                                        <option value="product">Products</option>
                                        <option value="customer">Customers</option>
                                        <option value="market">Markets</option>
                                        <option value="merchant_group">Merchants</option>
                                        <option value="product_cluster">Product Clusters</option>
                                        <option value="customer_cluster">Customer Clusters</option>
                                    </select>
                                    <span className="text-sm text-gray-500">
                                        {sortedBreakdown.length} items
                                    </span>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full table-fixed">
                                <colgroup>
                                    <col style={{ width: '280px', minWidth: '150px' }} />
                                    <col style={{ width: '100px', minWidth: '80px' }} />
                                    <col style={{ width: '100px', minWidth: '80px' }} />
                                    <col style={{ width: '100px', minWidth: '80px' }} />
                                    <col style={{ width: '110px', minWidth: '90px' }} />
                                    <col style={{ width: '100px', minWidth: '80px' }} />
                                    <col style={{ width: '100px', minWidth: '80px' }} />
                                    <col style={{ width: '110px', minWidth: '90px' }} />
                                </colgroup>
                                <thead>
                                    <tr className="border-b border-gray-200 bg-gray-50">
                                        <th className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider resize-x overflow-hidden cursor-col-resize" style={{ resize: 'horizontal', overflow: 'hidden', minWidth: '150px' }}>
                                            Name
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            <SortHeader field="revenue" label="Current" />
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            LY
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            <SortHeader field="ly_pct_change" label="vs LY %" />
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            <SortHeader field="ly_delta" label="vs LY $" />
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            LLY
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            vs LLY %
                                        </th>
                                        <th className="px-6 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                            vs LLY $
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {paginatedBreakdown.map((item, idx) => (
                                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 text-sm font-medium text-gray-900" title={item.label}>
                                                <div className="truncate">{item.label}</div>
                                            </td>
                                            <td className="px-6 py-4 text-sm text-right font-semibold text-gray-900">
                                                {formatCurrency(item.revenue)}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-right text-gray-600">
                                                {formatCurrency(item.ly_revenue)}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-right">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${item.ly_pct_change >= 0
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-red-100 text-red-800'
                                                    }`}>
                                                    {item.ly_pct_change >= 0 ? (
                                                        <TrendingUp className="h-3 w-3" />
                                                    ) : (
                                                        <TrendingDown className="h-3 w-3" />
                                                    )}
                                                    {formatPct(item.ly_pct_change)}
                                                </span>
                                            </td>
                                            <td className={`px-6 py-4 text-sm text-right font-medium ${item.ly_delta >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                {formatDelta(item.ly_delta)}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-right text-gray-600">
                                                {formatCurrency(item.lly_revenue)}
                                            </td>
                                            <td className="px-6 py-4 text-sm text-right">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${item.lly_pct_change >= 0
                                                    ? 'bg-green-100 text-green-800'
                                                    : 'bg-red-100 text-red-800'
                                                    }`}>
                                                    {item.lly_pct_change >= 0 ? (
                                                        <TrendingUp className="h-3 w-3" />
                                                    ) : (
                                                        <TrendingDown className="h-3 w-3" />
                                                    )}
                                                    {formatPct(item.lly_pct_change)}
                                                </span>
                                            </td>
                                            <td className={`px-6 py-4 text-sm text-right font-medium ${item.lly_delta >= 0 ? 'text-green-600' : 'text-red-600'
                                                }`}>
                                                {formatDelta(item.lly_delta)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {sortedBreakdown.length === 0 && (
                            <div className="p-8 text-center text-gray-500">
                                No data available for the selected filters and date range.
                            </div>
                        )}

                        {/* Pagination Controls */}
                        {totalPages > 1 && (
                            <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4">
                                <div className="text-sm text-gray-500">
                                    Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, sortedBreakdown.length)} of {sortedBreakdown.length} items
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        aria-label="Previous page"
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                        Previous
                                    </button>
                                    <span className="text-sm text-gray-600">
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                        className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                        aria-label="Next page"
                                    >
                                        Next
                                        <ChevronRight className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

// Comparison Badge Component
function ComparisonBadge({ label, current, previous, formatValue }: {
    label: string;
    current: number;
    previous: number;
    formatValue: (val: number) => string;
}) {
    const delta = current - previous;
    const pctChange = previous > 0 ? ((delta / previous) * 100) : 0;
    const isPositive = delta >= 0;

    return (
        <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">{label}</span>
            <div className="flex items-center gap-2">
                {isPositive ? (
                    <TrendingUp className="h-3 w-3 text-green-500" />
                ) : (
                    <TrendingDown className="h-3 w-3 text-red-500" />
                )}
                <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
                    {isPositive ? '+' : ''}{pctChange.toFixed(1)}%
                </span>
                <span className={`${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                    ({isPositive ? '+' : ''}{formatValue(delta)})
                </span>
            </div>
        </div>
    );
}

function FilterGroup({ title, options, selected, onToggle }: any) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    const filteredOptions = (options || []).filter((opt: string) =>
        opt?.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="relative">
            <h4 className="mb-2 text-sm font-medium text-gray-700">{title}</h4>

            {/* Selected items as chips */}
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                    {selected.map((item: string) => (
                        <span
                            key={item}
                            className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700"
                        >
                            <span className="max-w-[100px] truncate" title={item}>{item}</span>
                            <button
                                onClick={() => onToggle(item)}
                                className="hover:text-blue-900"
                            >
                                ×
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {/* Search input */}
            <div className="relative">
                <input
                    type="text"
                    placeholder={`Search ${title.toLowerCase()}...`}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onFocus={() => setIsOpen(true)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                {options?.length > 0 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {options.length}
                    </span>
                )}
            </div>

            {/* Dropdown list */}
            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                        {filteredOptions.length === 0 ? (
                            <div className="px-3 py-2 text-sm text-gray-500">No matches found</div>
                        ) : (
                            filteredOptions.map((opt: string) => (
                                <button
                                    key={opt}
                                    onClick={() => {
                                        onToggle(opt);
                                        setSearch('');
                                    }}
                                    className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-50 flex items-center justify-between ${selected.includes(opt) ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                                        }`}
                                >
                                    <span className="truncate">{opt}</span>
                                    {selected.includes(opt) && (
                                        <span className="text-blue-600">✓</span>
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
