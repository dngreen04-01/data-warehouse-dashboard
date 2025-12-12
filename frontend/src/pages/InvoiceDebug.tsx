import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Loader2, Search, AlertTriangle, CheckCircle, XCircle,
    Download, RefreshCw, Package, EyeOff
} from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

interface SalesLine {
    sales_line_id: number;
    invoice_number: string;
    invoice_date: string;
    document_type: string | null;
    customer_id: string;
    customer_name: string;
    product_code: string;
    item_name: string;
    qty: number;
    line_amount: number;
    load_source: string;
    product_group: string | null;
    is_excluded: boolean;
}

interface DocumentTypeSummary {
    document_type: string;
    count: number;
    total_amount: number;
}

export default function InvoiceDebug() {
    const [loading, setLoading] = useState(true);
    const [salesLines, setSalesLines] = useState<SalesLine[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDocType, setSelectedDocType] = useState<string | null>(null);
    const [dateRange, setDateRange] = useState({
        start: `${new Date().getFullYear()}-01-01`,
        end: format(new Date(), 'yyyy-MM-dd')
    });
    const [sortBy, setSortBy] = useState<'date' | 'amount'>('amount');
    const [sortDesc, setSortDesc] = useState(true);
    const [showExcluded, setShowExcluded] = useState<'all' | 'included' | 'excluded'>('all');

    useEffect(() => {
        fetchSalesLines();
    }, [dateRange]);

    const fetchSalesLines = async () => {
        setLoading(true);
        try {
            // Use RPC function to access dw.fct_sales_line (schema not directly exposed)
            const { data, error } = await supabase.rpc('get_sales_lines_debug', {
                p_start_date: dateRange.start,
                p_end_date: dateRange.end
            });

            if (error) throw error;
            setSalesLines(data || []);
        } catch (error) {
            console.error('Error fetching sales lines:', error);
        } finally {
            setLoading(false);
        }
    };

    // Calculate summary by document type
    const documentTypeSummary = useMemo((): DocumentTypeSummary[] => {
        const summary: Record<string, { count: number; total_amount: number }> = {};

        salesLines.forEach(line => {
            const docType = line.document_type || 'NULL/Unknown';
            if (!summary[docType]) {
                summary[docType] = { count: 0, total_amount: 0 };
            }
            summary[docType].count++;
            summary[docType].total_amount += line.line_amount || 0;
        });

        return Object.entries(summary)
            .map(([document_type, data]) => ({
                document_type,
                ...data
            }))
            .sort((a, b) => b.total_amount - a.total_amount);
    }, [salesLines]);

    // Filter and sort
    const filteredLines = useMemo(() => {
        let result = [...salesLines];

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(line =>
                line.invoice_number?.toLowerCase().includes(query) ||
                line.customer_name?.toLowerCase().includes(query) ||
                line.product_code?.toLowerCase().includes(query) ||
                line.item_name?.toLowerCase().includes(query)
            );
        }

        if (selectedDocType) {
            if (selectedDocType === 'NULL/Unknown') {
                result = result.filter(line => !line.document_type);
            } else {
                result = result.filter(line => line.document_type === selectedDocType);
            }
        }

        // Filter by excluded status
        if (showExcluded === 'included') {
            result = result.filter(line => !line.is_excluded);
        } else if (showExcluded === 'excluded') {
            result = result.filter(line => line.is_excluded);
        }

        // Sort
        result.sort((a, b) => {
            if (sortBy === 'date') {
                const comp = a.invoice_date.localeCompare(b.invoice_date);
                return sortDesc ? -comp : comp;
            } else {
                const comp = (a.line_amount || 0) - (b.line_amount || 0);
                return sortDesc ? -comp : comp;
            }
        });

        return result;
    }, [salesLines, searchQuery, selectedDocType, showExcluded, sortBy, sortDesc]);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

    const totalRevenue = salesLines.reduce((sum, line) => sum + (line.line_amount || 0), 0);
    const filteredTotal = filteredLines.reduce((sum, line) => sum + (line.line_amount || 0), 0);
    const includedRevenue = salesLines.filter(l => !l.is_excluded).reduce((sum, line) => sum + (line.line_amount || 0), 0);
    const excludedRevenue = salesLines.filter(l => l.is_excluded).reduce((sum, line) => sum + (line.line_amount || 0), 0);
    const excludedCount = salesLines.filter(l => l.is_excluded).length;

    // Identify problematic document types (not ACCREC or standard sales types)
    const getDocTypeStatus = (docType: string | null) => {
        if (!docType) return 'warning';
        const salesTypes = ['ACCREC', 'Tax Invoice', 'INVOICE'];
        const billTypes = ['ACCPAY', 'Bill', 'BILL'];

        if (salesTypes.some(t => docType.toUpperCase().includes(t.toUpperCase()))) return 'ok';
        if (billTypes.some(t => docType.toUpperCase().includes(t.toUpperCase()))) return 'error';
        return 'warning';
    };

    const exportToCSV = () => {
        const headers = ['Invoice #', 'Date', 'Document Type', 'Customer', 'Product', 'Item', 'Product Group', 'Qty', 'Amount', 'Source', 'Excluded'];
        const rows = filteredLines.map(line => [
            line.invoice_number,
            line.invoice_date,
            line.document_type || '',
            line.customer_name || '',
            line.product_code || '',
            line.item_name || '',
            line.product_group || '',
            line.qty,
            line.line_amount,
            line.load_source,
            line.is_excluded ? 'Yes' : 'No'
        ]);

        const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `invoice-debug-${format(new Date(), 'yyyy-MM-dd')}.csv`;
        a.click();
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900 flex items-center gap-2">
                        <AlertTriangle className="h-6 w-6 text-amber-500" />
                        Invoice Debug
                    </h1>
                    <p className="text-sm text-gray-500">
                        Analyze sales line data to identify revenue calculation issues
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={fetchSalesLines}
                        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Refresh
                    </button>
                    <button
                        onClick={exportToCSV}
                        className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                        <Download className="h-4 w-4" />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Date Range */}
            <div className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <span className="text-sm font-medium text-gray-600">Date Range:</span>
                <input
                    type="date"
                    value={dateRange.start}
                    onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
                <span className="text-gray-400">to</span>
                <input
                    type="date"
                    value={dateRange.end}
                    onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                />
            </div>

            {/* Summary Cards by Document Type */}
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-amber-800 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Revenue by Document Type (click to filter)
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {documentTypeSummary.map((summary) => {
                        const status = getDocTypeStatus(summary.document_type);
                        const isSelected = selectedDocType === summary.document_type;

                        return (
                            <button
                                key={summary.document_type}
                                onClick={() => setSelectedDocType(isSelected ? null : summary.document_type)}
                                className={clsx(
                                    'rounded-lg border p-3 text-left transition-all',
                                    isSelected
                                        ? 'border-blue-300 bg-blue-50 ring-2 ring-blue-500'
                                        : status === 'ok'
                                            ? 'border-green-200 bg-green-50 hover:border-green-300'
                                            : status === 'error'
                                                ? 'border-red-200 bg-red-50 hover:border-red-300'
                                                : 'border-amber-200 bg-amber-50 hover:border-amber-300'
                                )}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <span className={clsx(
                                        'text-xs font-semibold uppercase tracking-wider',
                                        status === 'ok' ? 'text-green-700' :
                                            status === 'error' ? 'text-red-700' : 'text-amber-700'
                                    )}>
                                        {summary.document_type}
                                    </span>
                                    {status === 'ok' && <CheckCircle className="h-4 w-4 text-green-500" />}
                                    {status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                                    {status === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                                </div>
                                <p className="text-lg font-bold text-gray-900">
                                    {formatCurrency(summary.total_amount)}
                                </p>
                                <p className="text-xs text-gray-500">
                                    {summary.count.toLocaleString()} line items
                                </p>
                            </button>
                        );
                    })}
                </div>
                <div className="mt-3 pt-3 border-t border-amber-200">
                    <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-amber-800">Total Being Counted as Revenue:</span>
                        <span className="font-bold text-gray-900">{formatCurrency(totalRevenue)}</span>
                    </div>
                    {selectedDocType && (
                        <div className="flex items-center justify-between text-sm mt-1">
                            <span className="font-medium text-blue-700">Filtered Total ({selectedDocType}):</span>
                            <span className="font-bold text-blue-700">{formatCurrency(filteredTotal)}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Product Group Exclusion Summary */}
            <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-purple-800 flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    Product Group Filter Status
                </h3>
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                        <p className="text-xs font-semibold text-green-700 uppercase">Included in Revenue</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(includedRevenue)}</p>
                        <p className="text-xs text-gray-500">{(salesLines.length - excludedCount).toLocaleString()} line items</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <p className="text-xs font-semibold text-gray-600 uppercase">Excluded (Non-Revenue Groups)</p>
                        <p className="text-lg font-bold text-gray-500">{formatCurrency(excludedRevenue)}</p>
                        <p className="text-xs text-gray-500">{excludedCount.toLocaleString()} line items</p>
                    </div>
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <p className="text-xs font-semibold text-blue-700 uppercase">Total (All Lines)</p>
                        <p className="text-lg font-bold text-gray-900">{formatCurrency(totalRevenue)}</p>
                        <p className="text-xs text-gray-500">{salesLines.length.toLocaleString()} line items</p>
                    </div>
                </div>
                <p className="mt-3 text-xs text-purple-700">
                    Excluded groups: Freight, consumables, Pallet access, Commission, contract, documentation, risk, Transport/mileage, Load Building, Container, Freight National, Fuel
                </p>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
                <div className="flex items-center gap-1">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-gray-600">ACCREC/Sales Invoice = Correct (income)</span>
                </div>
                <div className="flex items-center gap-1">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-gray-600">ACCPAY/Bill = Incorrect (expense, should not count)</span>
                </div>
                <div className="flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-gray-600">Unknown = Review needed</span>
                </div>
            </div>

            {/* Search and Sort */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search invoices, customers, products..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Show:</span>
                    <select
                        value={showExcluded}
                        onChange={(e) => setShowExcluded(e.target.value as 'all' | 'included' | 'excluded')}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="all">All Lines</option>
                        <option value="included">Included Only</option>
                        <option value="excluded">Excluded Only</option>
                    </select>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Sort by:</span>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as 'date' | 'amount')}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                        <option value="amount">Amount</option>
                        <option value="date">Date</option>
                    </select>
                    <button
                        onClick={() => setSortDesc(!sortDesc)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                    >
                        {sortDesc ? '↓ Desc' : '↑ Asc'}
                    </button>
                </div>
                {(searchQuery || selectedDocType || showExcluded !== 'all') && (
                    <button
                        onClick={() => {
                            setSearchQuery('');
                            setSelectedDocType(null);
                            setShowExcluded('all');
                        }}
                        className="text-sm text-blue-600 hover:underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {/* Results count */}
            <div className="text-sm text-gray-500">
                Showing {filteredLines.length.toLocaleString()} of {salesLines.length.toLocaleString()} line items
            </div>

            {/* Data Table */}
            {loading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
            ) : (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Doc Type</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Customer</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Product</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Group</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Qty</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Amount</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Source</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                                {filteredLines.slice(0, 500).map((line) => {
                                    const status = getDocTypeStatus(line.document_type);
                                    return (
                                        <tr
                                            key={line.sales_line_id}
                                            className={clsx(
                                                'hover:bg-gray-50',
                                                status === 'error' && 'bg-red-50',
                                                line.is_excluded && 'bg-gray-100 opacity-60'
                                            )}
                                        >
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                                                {line.invoice_number}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500">
                                                {format(new Date(line.invoice_date), 'MMM d, yyyy')}
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                <span className={clsx(
                                                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                                    status === 'ok' ? 'bg-green-100 text-green-700' :
                                                        status === 'error' ? 'bg-red-100 text-red-700' :
                                                            'bg-amber-100 text-amber-700'
                                                )}>
                                                    {status === 'ok' && <CheckCircle className="h-3 w-3" />}
                                                    {status === 'error' && <XCircle className="h-3 w-3" />}
                                                    {status === 'warning' && <AlertTriangle className="h-3 w-3" />}
                                                    {line.document_type || 'NULL'}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px] truncate" title={line.customer_name}>
                                                {line.customer_name}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500">
                                                <div className="max-w-[150px] truncate" title={line.item_name}>
                                                    <span className="font-medium">{line.product_code}</span>
                                                    {line.item_name && <span className="text-gray-400 ml-1">- {line.item_name}</span>}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-sm">
                                                {line.product_group ? (
                                                    <span className={clsx(
                                                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                                        line.is_excluded
                                                            ? 'bg-gray-200 text-gray-600'
                                                            : 'bg-blue-100 text-blue-700'
                                                    )}>
                                                        {line.is_excluded && <EyeOff className="h-3 w-3" />}
                                                        {line.product_group}
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-400 text-xs">-</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-500 text-right">
                                                {line.qty?.toLocaleString()}
                                            </td>
                                            <td className={clsx(
                                                'px-4 py-3 text-sm text-right font-medium',
                                                status === 'error' ? 'text-red-600' :
                                                    line.is_excluded ? 'text-gray-400 line-through' : 'text-gray-900'
                                            )}>
                                                {formatCurrency(line.line_amount)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-400">
                                                {line.load_source}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {filteredLines.length > 500 && (
                        <div className="bg-gray-50 px-4 py-3 text-center text-sm text-gray-500">
                            Showing first 500 rows. Export to CSV to see all {filteredLines.length.toLocaleString()} rows.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
