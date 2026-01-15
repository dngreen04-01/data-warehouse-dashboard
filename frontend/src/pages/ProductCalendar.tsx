import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Filter, AlertCircle, RefreshCw, Search, Download } from 'lucide-react';
import { format, startOfYear, endOfYear, endOfDay, startOfMonth, addMonths, subYears } from 'date-fns';

interface CalendarData {
    label: string;
    month_date: string;
    revenue: number;
    quantity: number;
}

interface MonthColumn {
    date: string;
    label: string;
}

interface DataRow {
    label: string;
    monthlyData: Map<string, { revenue: number; quantity: number }>;
    totalRevenue: number;
    totalQuantity: number;
}

type Dimension = 'product' | 'customer' | 'market' | 'merchant_group' | 'product_cluster' | 'customer_cluster';

const DIMENSION_LABELS: Record<Dimension, string> = {
    product: 'Products',
    customer: 'Customers',
    market: 'Markets',
    merchant_group: 'Merchants',
    product_cluster: 'Product Clusters',
    customer_cluster: 'Customer Clusters'
};

export default function ProductCalendar() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rawData, setRawData] = useState<CalendarData[]>([]);
    const [options, setOptions] = useState<any>({});

    // Dimension selector
    const [dimension, setDimension] = useState<Dimension>('product');

    // Date range state
    const [dateRange, setDateRange] = useState({
        start: format(startOfYear(new Date()), 'yyyy-01-01'),
        end: format(endOfDay(new Date()), 'yyyy-MM-dd'),
    });
    const [selectedPreset, setSelectedPreset] = useState('year_to_date');

    // Filters state (same as Dashboard)
    const [filters, setFilters] = useState({
        merchant_group: [] as string[],
        product_group: [] as string[],
        market: [] as string[],
        customer_cluster: [] as string[],
        product_cluster: [] as string[]
    });
    const [showFilters, setShowFilters] = useState(false);

    // Display options
    const [displayMode, setDisplayMode] = useState<'revenue' | 'quantity'>('revenue');
    const [searchQuery, setSearchQuery] = useState('');

    // Fetch filter options on mount
    useEffect(() => {
        const fetchOptions = async () => {
            try {
                const { data, error } = await supabase.rpc('get_filter_options');
                if (error) {
                    console.error('Error fetching filter options:', error);
                } else if (data) {
                    setOptions(data);
                }
            } catch (err) {
                console.error('Error fetching filter options:', err);
            }
        };
        fetchOptions();
    }, []);

    // Fetch data when filters/dates/dimension change
    useEffect(() => {
        fetchData();
    }, [dateRange, filters, dimension]);

    const applyPreset = (preset: string) => {
        const today = new Date();
        let start = new Date();
        let end = new Date();

        switch (preset) {
            case 'year_to_date':
                start = startOfYear(today);
                end = today;
                break;
            case 'last_year':
                start = startOfYear(subYears(today, 1));
                end = endOfYear(subYears(today, 1));
                break;
            case 'custom':
                return;
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
            const { data, error: rpcError } = await supabase.rpc('get_product_sales_calendar', {
                p_dimension: dimension,
                p_start_date: dateRange.start,
                p_end_date: dateRange.end,
                p_merchant_group: filters.merchant_group.length ? filters.merchant_group : null,
                p_product_group: filters.product_group.length ? filters.product_group : null,
                p_market: filters.market.length ? filters.market : null,
                p_cluster: filters.customer_cluster.length ? filters.customer_cluster : null,
                p_product_cluster: filters.product_cluster.length ? filters.product_cluster : null,
            });

            if (rpcError) throw rpcError;
            setRawData(data || []);
        } catch (err) {
            console.error('Error fetching calendar data:', err);
            setError(err instanceof Error ? err.message : 'Failed to load calendar data');
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

    // Transform raw data into grid structure
    const { monthColumns, dataRows } = useMemo(() => {
        // Generate month columns from date range
        const columns: MonthColumn[] = [];
        let currentDate = startOfMonth(new Date(dateRange.start));
        const endDate = new Date(dateRange.end);

        while (currentDate <= endDate) {
            columns.push({
                date: format(currentDate, 'yyyy-MM-01'),
                label: format(currentDate, 'MMM yyyy')
            });
            currentDate = addMonths(currentDate, 1);
        }

        // Group data by label
        const dataMap = new Map<string, DataRow>();

        rawData.forEach(item => {
            if (!item.label) return;

            if (!dataMap.has(item.label)) {
                dataMap.set(item.label, {
                    label: item.label,
                    monthlyData: new Map(),
                    totalRevenue: 0,
                    totalQuantity: 0
                });
            }

            const row = dataMap.get(item.label)!;
            const monthKey = format(new Date(item.month_date), 'yyyy-MM-01');
            row.monthlyData.set(monthKey, {
                revenue: item.revenue,
                quantity: item.quantity
            });
            row.totalRevenue += Number(item.revenue) || 0;
            row.totalQuantity += Number(item.quantity) || 0;
        });

        // Convert to array and filter by search
        let rows = Array.from(dataMap.values());

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            rows = rows.filter(r => r.label?.toLowerCase().includes(query));
        }

        // Sort by total revenue descending
        rows.sort((a, b) => b.totalRevenue - a.totalRevenue);

        return { monthColumns: columns, dataRows: rows };
    }, [rawData, dateRange, searchQuery]);

    // Export to CSV
    const exportToCSV = () => {
        const headers = [DIMENSION_LABELS[dimension], ...monthColumns.map(c => c.label), 'Total'];
        const rows = dataRows.map(row => {
            const monthValues = monthColumns.map(col => {
                const data = row.monthlyData.get(col.date);
                const value = displayMode === 'revenue' ? data?.revenue : data?.quantity;
                return value ? value.toFixed(displayMode === 'revenue' ? 2 : 0) : '';
            });
            const total = displayMode === 'revenue' ? row.totalRevenue.toFixed(2) : row.totalQuantity.toFixed(0);
            return [row.label, ...monthValues, total];
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sales_calendar_${dimension}_${displayMode}_${dateRange.start}_to_${dateRange.end}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);

    const formatNumber = (val: number) =>
        new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(val);

    const activeFilterCount = Object.values(filters).reduce((sum, arr) => sum + arr.length, 0);

    return (
        <div className="space-y-6">
            {/* Header & Controls */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Sales Calendar</h1>
                    <p className="text-sm text-gray-500">Monthly sales by {DIMENSION_LABELS[dimension].toLowerCase()}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${showFilters ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700'}`}
                    >
                        <Filter className="h-4 w-4" />
                        Filters
                        {activeFilterCount > 0 && (
                            <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-xs text-white">
                                {activeFilterCount}
                            </span>
                        )}
                    </button>
                    <div className="flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2">
                        <select
                            value={selectedPreset}
                            onChange={(e) => applyPreset(e.target.value)}
                            className="border-none bg-transparent p-0 text-sm font-medium text-gray-700 focus:ring-0 cursor-pointer mr-2"
                        >
                            <option value="year_to_date">Year to Date</option>
                            <option value="last_year">Last Year</option>
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
                        <button
                            onClick={() => setFilters({ merchant_group: [], product_group: [], market: [], customer_cluster: [], product_cluster: [] })}
                            className="text-sm text-red-600 hover:underline"
                        >
                            Clear All
                        </button>
                    </div>
                    <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
                        <FilterGroup title="Market" options={options.markets || []} selected={filters.market} onToggle={(v: string) => toggleFilter('market', v)} />
                        <FilterGroup title="Product" options={options.product_groups || []} selected={filters.product_group} onToggle={(v: string) => toggleFilter('product_group', v)} />
                        <FilterGroup title="Merchant Group" options={options.merchant_groups || []} selected={filters.merchant_group} onToggle={(v: string) => toggleFilter('merchant_group', v)} />
                        <FilterGroup title="Customer Cluster" options={options.customer_clusters || options.clusters || []} selected={filters.customer_cluster} onToggle={(v: string) => toggleFilter('customer_cluster', v)} />
                        <FilterGroup title="Product Cluster" options={options.product_clusters || []} selected={filters.product_cluster} onToggle={(v: string) => toggleFilter('product_cluster', v)} />
                    </div>
                </div>
            )}

            {/* Display Controls */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-4">
                    {/* Dimension Selector */}
                    <div className="flex items-center gap-2">
                        <label className="text-sm font-medium text-gray-600">View by:</label>
                        <select
                            value={dimension}
                            onChange={(e) => setDimension(e.target.value as Dimension)}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                            <option value="product">Products</option>
                            <option value="customer">Customers</option>
                            <option value="market">Markets</option>
                            <option value="merchant_group">Merchants</option>
                            <option value="product_cluster">Product Clusters</option>
                            <option value="customer_cluster">Customer Clusters</option>
                        </select>
                    </div>

                    {/* Revenue/Quantity Toggle */}
                    <div className="flex rounded-lg border border-gray-300 bg-gray-50 p-0.5">
                        <button
                            onClick={() => setDisplayMode('revenue')}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${displayMode === 'revenue'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Revenue
                        </button>
                        <button
                            onClick={() => setDisplayMode('quantity')}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${displayMode === 'quantity'
                                ? 'bg-white text-gray-900 shadow-sm'
                                : 'text-gray-600 hover:text-gray-900'
                                }`}
                        >
                            Quantity
                        </button>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                        <input
                            type="text"
                            placeholder={`Search ${DIMENSION_LABELS[dimension].toLowerCase()}...`}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-64 rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                        {dataRows.length} {DIMENSION_LABELS[dimension].toLowerCase()}
                    </span>
                    <button
                        onClick={exportToCSV}
                        disabled={dataRows.length === 0}
                        className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-gray-900 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download className="h-4 w-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm" role="alert">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="h-5 w-5 text-red-600" />
                            <div>
                                <p className="font-medium text-red-800">Failed to load calendar data</p>
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

            {/* Calendar Grid */}
            {loading ? (
                <div className="flex h-96 items-center justify-center">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                </div>
            ) : error ? null : (
                <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                    <th className="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider min-w-[220px] border-r border-gray-200">
                                        {DIMENSION_LABELS[dimension]}
                                    </th>
                                    {monthColumns.map(col => (
                                        <th key={col.date} className="px-3 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider whitespace-nowrap min-w-[100px]">
                                            {col.label}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase tracking-wider bg-gray-100 min-w-[110px] border-l border-gray-200">
                                        Total
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {dataRows.map((row, idx) => (
                                    <tr key={`${row.label}-${idx}`} className="hover:bg-gray-50 transition-colors">
                                        <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-100">
                                            <div className="font-medium text-gray-900 truncate max-w-[200px]" title={row.label}>
                                                {row.label}
                                            </div>
                                        </td>
                                        {monthColumns.map(col => {
                                            const data = row.monthlyData.get(col.date);
                                            const value = displayMode === 'revenue'
                                                ? data?.revenue
                                                : data?.quantity;
                                            return (
                                                <td key={col.date} className="px-3 py-3 text-right text-sm">
                                                    {value ? (
                                                        <span className="text-gray-900">
                                                            {displayMode === 'revenue'
                                                                ? formatCurrency(value)
                                                                : formatNumber(value)
                                                            }
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-300">-</span>
                                                    )}
                                                </td>
                                            );
                                        })}
                                        <td className="px-4 py-3 text-right text-sm font-semibold bg-gray-50 border-l border-gray-100">
                                            {displayMode === 'revenue'
                                                ? formatCurrency(row.totalRevenue)
                                                : formatNumber(row.totalQuantity)
                                            }
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {dataRows.length === 0 && (
                        <div className="p-8 text-center text-gray-500">
                            No data found for the selected filters and date range.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// Filter Group Component
function FilterGroup({ title, options, selected, onToggle }: {
    title: string;
    options: string[];
    selected: string[];
    onToggle: (value: string) => void;
}) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);

    const safeOptions = Array.isArray(options) ? options : [];
    const filteredOptions = safeOptions.filter((opt: string) =>
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
                {safeOptions.length > 0 && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                        {safeOptions.length}
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
                            <div className="px-3 py-2 text-sm text-gray-500">
                                {safeOptions.length === 0 ? 'No options available' : 'No matches found'}
                            </div>
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
