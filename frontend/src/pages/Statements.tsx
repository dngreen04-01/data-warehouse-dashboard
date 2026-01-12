import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Download, FileText, ChevronRight, Search, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001';

const AGING_CONFIG = {
    'current': { label: 'Current', color: 'bg-green-100 text-green-800', priority: 0 },
    '1-30': { label: '1-30 Days', color: 'bg-yellow-100 text-yellow-800', priority: 1 },
    '31-60': { label: '31-60 Days', color: 'bg-orange-100 text-orange-800', priority: 2 },
    '61-90': { label: '61-90 Days', color: 'bg-red-100 text-red-800', priority: 3 },
    '90+': { label: '90+ Days', color: 'bg-red-200 text-red-900', priority: 4 },
};

export default function Statements() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [statements, setStatements] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAging, setSelectedAging] = useState<string | null>(null);
    const [downloadingPdf, setDownloadingPdf] = useState<string | null>(null);
    const [downloadStatus, setDownloadStatus] = useState<{ merchant: string; status: 'success' | 'error'; message: string } | null>(null);

    useEffect(() => {
        fetchStatements();
    }, []);

    const handleDownloadPdf = async (merchantGroup: string) => {
        setDownloadingPdf(merchantGroup);
        setDownloadStatus(null);

        try {
            const response = await fetch(`${API_BASE_URL}/api/statement/${encodeURIComponent(merchantGroup)}/pdf`);

            if (!response.ok) {
                throw new Error(`Failed to generate PDF: ${response.statusText}`);
            }

            // Get filename from Content-Disposition header or create one
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = `Statement_${merchantGroup}_${new Date().toISOString().split('T')[0]}.pdf`;
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="(.+)"/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            // Download the PDF
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            setDownloadStatus({ merchant: merchantGroup, status: 'success', message: 'PDF downloaded successfully' });

            // Clear success message after 3 seconds
            setTimeout(() => setDownloadStatus(null), 3000);

        } catch (error) {
            console.error('Error downloading PDF:', error);
            setDownloadStatus({
                merchant: merchantGroup,
                status: 'error',
                message: error instanceof Error ? error.message : 'Failed to download PDF'
            });
        } finally {
            setDownloadingPdf(null);
        }
    };

    const fetchStatements = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .from('vw_statement_details')
                .select('*')
                .order('invoice_date', { ascending: false });

            if (fetchError) throw fetchError;
            setStatements(data || []);
        } catch (err) {
            console.error('Error fetching statements:', err);
            setError(err instanceof Error ? err.message : 'Failed to load statements. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Calculate aging summary
    const agingSummary = useMemo(() => {
        const summary: Record<string, { count: number; amount: number }> = {};
        statements.forEach(inv => {
            const bucket = inv.aging_bucket || 'current';
            if (!summary[bucket]) {
                summary[bucket] = { count: 0, amount: 0 };
            }
            summary[bucket].count++;
            summary[bucket].amount += inv.outstanding_amount || 0;
        });
        return summary;
    }, [statements]);

    // Filter statements
    const filteredStatements = useMemo(() => {
        let result = [...statements];

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(inv =>
                inv.merchant_group?.toLowerCase().includes(query) ||
                inv.customer_name?.toLowerCase().includes(query) ||
                inv.invoice_number?.toLowerCase().includes(query)
            );
        }

        if (selectedAging) {
            result = result.filter(inv => inv.aging_bucket === selectedAging);
        }

        return result;
    }, [statements, searchQuery, selectedAging]);

    // Grouping logic - group by merchant_group for consolidated statements
    const grouped = filteredStatements.reduce((acc: any, curr) => {
        const key = curr.merchant_group || curr.customer_name;
        if (!acc[key]) {
            acc[key] = {
                invoices: [],
                headOfficeAddress: curr.head_office_address
            };
        }
        acc[key].invoices.push(curr);
        return acc;
    }, {});

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' }).format(val);

    const totalOutstanding = statements.reduce((sum, inv) => sum + (inv.outstanding_amount || 0), 0);

    return (
        <div className="space-y-6">
            {/* Header with Total */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Consolidated Statements</h1>
                    <p className="text-sm text-gray-500">
                        Overview of outstanding invoices by Merchant Group
                    </p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Outstanding</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalOutstanding)}</p>
                    <p className="text-xs text-gray-400">{statements.length} invoices</p>
                </div>
            </div>

            {/* Aging Summary Cards */}
            {!loading && statements.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                    {Object.entries(AGING_CONFIG).map(([bucket, config]) => {
                        const data = agingSummary[bucket] || { count: 0, amount: 0 };
                        const isSelected = selectedAging === bucket;
                        return (
                            <button
                                key={bucket}
                                onClick={() => setSelectedAging(isSelected ? null : bucket)}
                                className={clsx(
                                    'rounded-xl border p-4 text-left transition-all hover:shadow-md',
                                    isSelected
                                        ? 'border-blue-200 bg-blue-50 ring-1 ring-blue-500'
                                        : 'border-gray-200 bg-white hover:border-gray-300'
                                )}
                            >
                                <div className="flex items-center justify-between">
                                    <span className={clsx(
                                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                                        config.color
                                    )}>
                                        {config.label}
                                    </span>
                                    <span className="text-xs text-gray-500">{data.count}</span>
                                </div>
                                <p className="mt-2 text-lg font-semibold text-gray-900">
                                    {formatCurrency(data.amount)}
                                </p>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Search Bar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search merchant groups, customers, invoices..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
                {(searchQuery || selectedAging) && (
                    <button
                        onClick={() => {
                            setSearchQuery('');
                            setSelectedAging(null);
                        }}
                        className="text-sm text-blue-600 hover:underline"
                    >
                        Clear filters
                    </button>
                )}
            </div>

            {/* Error Banner */}
            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm" role="alert">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="h-5 w-5 text-red-600" />
                            <div>
                                <p className="font-medium text-red-800">Failed to load statements</p>
                                <p className="text-sm text-red-600">{error}</p>
                            </div>
                        </div>
                        <button
                            onClick={() => fetchStatements()}
                            className="flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200 transition-colors"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Retry
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
            ) : error ? null : (
                <div className="grid gap-6">
                    {Object.keys(grouped).length === 0 ? (
                        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
                            <FileText className="mx-auto h-12 w-12 text-gray-300" />
                            <p className="mt-2 text-sm text-gray-500">
                                {statements.length === 0
                                    ? 'No open invoices found'
                                    : 'No invoices match your search criteria'}
                            </p>
                            {(searchQuery || selectedAging) && (
                                <button
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSelectedAging(null);
                                    }}
                                    className="mt-2 text-sm text-blue-600 hover:underline"
                                >
                                    Clear filters
                                </button>
                            )}
                        </div>
                    ) : (
                        Object.entries(grouped).map(([groupName, groupData]) => {
                            const { invoices, headOfficeAddress } = groupData as { invoices: any[]; headOfficeAddress: string | null };
                            const totalDue = invoices.reduce((sum: number, inv: any) => sum + (inv.outstanding_amount || 0), 0);
                            const uniqueBranches = [...new Set(invoices.map((inv: any) => inv.customer_name))];

                            return (
                                <div key={groupName} className="rounded-xl border bg-white shadow-sm overflow-hidden">
                                    <div className="border-b bg-gray-50 px-6 py-4 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                                                <FileText className="h-5 w-5 text-gray-500" />
                                                {groupName}
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                                {invoices.length} open invoices from {uniqueBranches.length} {uniqueBranches.length === 1 ? 'branch' : 'branches'}
                                            </p>
                                            {headOfficeAddress && (
                                                <p className="text-xs text-gray-400 mt-1">
                                                    Statement to: {headOfficeAddress.split(',').slice(0, 2).join(', ')}
                                                </p>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm text-gray-500">Total Outstanding</p>
                                            <p className="text-xl font-bold text-gray-900">{formatCurrency(totalDue)}</p>
                                        </div>
                                    </div>
                                    <div className="px-6 py-4">
                                        <table className="min-w-full divide-y divide-gray-200">
                                            <thead>
                                                <tr>
                                                    <th className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Invoice #</th>
                                                    <th className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Date</th>
                                                    <th className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Customer</th>
                                                    <th className="px-3 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Aging</th>
                                                    <th className="px-3 py-3.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Amount Due</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-200 bg-white">
                                                {invoices.map((inv) => (
                                                    <tr key={inv.invoice_number}>
                                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 font-medium">{inv.invoice_number}</td>
                                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{format(new Date(inv.invoice_date), 'MMM d, yyyy')}</td>
                                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{inv.customer_name}</td>
                                                        <td className="whitespace-nowrap px-3 py-4 text-sm">
                                                            <span className={clsx(
                                                                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                                AGING_CONFIG[inv.aging_bucket as keyof typeof AGING_CONFIG]?.color || 'bg-gray-100 text-gray-800'
                                                            )}>
                                                                {AGING_CONFIG[inv.aging_bucket as keyof typeof AGING_CONFIG]?.label || inv.aging_bucket}
                                                            </span>
                                                        </td>
                                                        <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-900 text-right font-medium">{formatCurrency(inv.outstanding_amount)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        <div className="mt-4 flex items-center justify-between">
                                            {downloadStatus && downloadStatus.merchant === groupName && (
                                                <div className={clsx(
                                                    'flex items-center gap-2 text-sm',
                                                    downloadStatus.status === 'success' ? 'text-green-600' : 'text-red-600'
                                                )}>
                                                    {downloadStatus.status === 'success' ? (
                                                        <CheckCircle className="h-4 w-4" />
                                                    ) : (
                                                        <AlertCircle className="h-4 w-4" />
                                                    )}
                                                    {downloadStatus.message}
                                                </div>
                                            )}
                                            <button
                                                onClick={() => handleDownloadPdf(groupName)}
                                                disabled={downloadingPdf === groupName}
                                                className={clsx(
                                                    'ml-auto flex items-center gap-2 text-sm font-semibold transition-colors',
                                                    downloadingPdf === groupName
                                                        ? 'text-gray-400 cursor-not-allowed'
                                                        : 'text-blue-600 hover:text-blue-500'
                                                )}
                                            >
                                                {downloadingPdf === groupName ? (
                                                    <>
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                        Generating PDF...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Download className="h-4 w-4" />
                                                        Download PDF
                                                        <ChevronRight className="h-4 w-4" />
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )
                        })
                    )}
                </div>
            )}
        </div>
    );
}
