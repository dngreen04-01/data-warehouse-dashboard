import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Download, FileText, ChevronRight, Search } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';

const AGING_CONFIG = {
    'current': { label: 'Current', color: 'bg-green-100 text-green-800', priority: 0 },
    '1-30': { label: '1-30 Days', color: 'bg-yellow-100 text-yellow-800', priority: 1 },
    '31-60': { label: '31-60 Days', color: 'bg-orange-100 text-orange-800', priority: 2 },
    '61-90': { label: '61-90 Days', color: 'bg-red-100 text-red-800', priority: 3 },
    '90+': { label: '90+ Days', color: 'bg-red-200 text-red-900', priority: 4 },
};

export default function Statements() {
    const [loading, setLoading] = useState(true);
    const [statements, setStatements] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedAging, setSelectedAging] = useState<string | null>(null);

    useEffect(() => {
        fetchStatements();
    }, []);

    const fetchStatements = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('vw_statement_details')
                .select('*')
                .order('invoice_date', { ascending: false });

            if (error) throw error;
            setStatements(data || []);
        } catch (error) {
            console.error('Error fetching statements:', error);
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

    // Grouping logic
    const grouped = filteredStatements.reduce((acc: any, curr) => {
        const key = curr.merchant_group || curr.customer_name;
        if (!acc[key]) acc[key] = [];
        acc[key].push(curr);
        return acc;
    }, {});

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

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

            {loading ? (
                <div className="flex h-64 items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
                </div>
            ) : (
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
                        Object.entries(grouped).map(([groupName, invList]) => {
                            const invoices = invList as any[];
                            const totalDue = invoices.reduce((sum: number, inv: any) => sum + (inv.outstanding_amount || 0), 0);

                            return (
                                <div key={groupName} className="rounded-xl border bg-white shadow-sm overflow-hidden">
                                    <div className="border-b bg-gray-50 px-6 py-4 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                                                <FileText className="h-5 w-5 text-gray-500" />
                                                {groupName}
                                            </h3>
                                            <p className="text-sm text-gray-500">{invoices.length} open invoices</p>
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
                                        <div className="mt-4 flex justify-end">
                                            <button className="flex items-center gap-2 text-sm font-semibold text-blue-600 hover:text-blue-500">
                                                <Download className="h-4 w-4" />
                                                Download PDF (Coming Soon)
                                                <ChevronRight className="h-4 w-4" />
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
