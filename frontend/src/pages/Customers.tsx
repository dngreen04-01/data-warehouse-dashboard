import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import {
    Loader2, Search, UserCircle, MapPin, Building2,
    ChevronDown, ChevronUp, Filter, Pencil, X, Tag
} from 'lucide-react';
import clsx from 'clsx';

interface Customer {
    customer_id: string;
    customer_name: string;
    contact_name: string;
    bill_to: string;
    merchant_group: string;
    market: string;
    customer_type: string;
    balance_total: number;
    archived: boolean;
    cluster_id: number | null;
    cluster_label: string | null;
}

type SortField = 'customer_name' | 'merchant_group' | 'market';
type SortDirection = 'asc' | 'desc';

export default function Customers() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortField, setSortField] = useState<SortField>('customer_name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [filterMarket, setFilterMarket] = useState<string>('');
    const [filterType, setFilterType] = useState<string>('');
    const [showFilters, setShowFilters] = useState(false);
    const [markets, setMarkets] = useState<string[]>([]);
    const [merchantGroups, setMerchantGroups] = useState<string[]>([]);

    // Edit modal state
    const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
    const [editForm, setEditForm] = useState({
        customer_name: '',
        market: '',
        merchant_group: '',
        customer_type: ''
    });
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchCustomers();
        fetchDropdownOptions();
    }, []);

    const fetchCustomers = async () => {
        setLoading(true);
        try {
            // Try using the RPC that includes cluster info
            const { data, error } = await supabase.rpc('get_customers_with_clusters');

            if (error) {
                // Fallback to direct query if RPC doesn't exist
                const { data: fallbackData } = await supabase
                    .from('dim_customer')
                    .select('*')
                    .eq('archived', false)
                    .order('customer_name');
                setCustomers((fallbackData || []).map(c => ({
                    ...c,
                    cluster_id: null,
                    cluster_label: null
                })));

                // Extract unique markets from fallback data
                const uniqueMarkets = [...new Set((fallbackData || []).map(c => c.market).filter(Boolean))];
                setMarkets(uniqueMarkets as string[]);
            } else {
                setCustomers(data || []);

                // Extract unique markets from data
                const uniqueMarkets = [...new Set((data || []).map((c: Customer) => c.market).filter(Boolean))];
                setMarkets(uniqueMarkets as string[]);
            }
        } catch (error) {
            console.error('Error fetching customers:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchDropdownOptions = async () => {
        try {
            // Fetch markets
            const { data: marketsData } = await supabase.rpc('get_distinct_markets');
            if (marketsData) {
                setMarkets(marketsData.map((d: { market: string }) => d.market));
            }

            // Fetch merchant groups
            const { data: merchantData } = await supabase.rpc('get_distinct_merchant_groups');
            if (merchantData) {
                setMerchantGroups(merchantData.map((d: { merchant_group: string }) => d.merchant_group));
            }
        } catch {
            // Fallback: markets are already set from customer data
        }
    };

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const SortIcon = ({ field }: { field: SortField }) => {
        if (sortField !== field) return null;
        return sortDirection === 'asc'
            ? <ChevronUp className="h-4 w-4" />
            : <ChevronDown className="h-4 w-4" />;
    };

    const filteredAndSortedCustomers = useMemo(() => {
        let result = [...customers];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(c =>
                c.customer_name?.toLowerCase().includes(query) ||
                c.merchant_group?.toLowerCase().includes(query) ||
                c.bill_to?.toLowerCase().includes(query)
            );
        }

        // Apply market filter
        if (filterMarket) {
            result = result.filter(c => c.market === filterMarket);
        }

        // Apply type filter
        if (filterType) {
            result = result.filter(c => c.customer_type === filterType);
        }

        // Apply sorting
        result.sort((a, b) => {
            let aVal = a[sortField] ?? '';
            let bVal = b[sortField] ?? '';

            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
            }

            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();

            if (sortDirection === 'asc') {
                return aVal.localeCompare(bVal);
            }
            return bVal.localeCompare(aVal);
        });

        return result;
    }, [customers, searchQuery, filterMarket, filterType, sortField, sortDirection]);

    const clearFilters = () => {
        setFilterMarket('');
        setFilterType('');
        setSearchQuery('');
    };

    const activeFilterCount = [filterMarket, filterType].filter(Boolean).length;

    const openEditModal = (customer: Customer) => {
        setEditingCustomer(customer);
        setEditForm({
            customer_name: customer.customer_name || '',
            market: customer.market || '',
            merchant_group: customer.merchant_group || '',
            customer_type: customer.customer_type || 'customer'
        });
    };

    const closeEditModal = () => {
        setEditingCustomer(null);
        setEditForm({
            customer_name: '',
            market: '',
            merchant_group: '',
            customer_type: ''
        });
    };

    const saveCustomer = async () => {
        if (!editingCustomer) return;

        setSaving(true);
        try {
            const { error } = await supabase.rpc('update_customer', {
                p_customer_id: editingCustomer.customer_id,
                p_customer_name: editForm.customer_name || null,
                p_market: editForm.market || null,
                p_merchant_group: editForm.merchant_group || null,
                p_customer_type: editForm.customer_type || null
            });

            if (error) throw error;

            // Update local state
            setCustomers(prev => prev.map(c =>
                c.customer_id === editingCustomer.customer_id
                    ? {
                        ...c,
                        customer_name: editForm.customer_name,
                        market: editForm.market,
                        merchant_group: editForm.merchant_group,
                        customer_type: editForm.customer_type
                    }
                    : c
            ));
            closeEditModal();
            fetchDropdownOptions(); // Refresh dropdown options
        } catch (error) {
            console.error('Error updating customer:', error);
            alert('Failed to update customer. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    const navigateToClusterManagement = () => {
        navigate('/clusters');
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Customers</h1>
                    <p className="text-sm text-gray-500">
                        Manage your customer database ({filteredAndSortedCustomers.length} customers)
                    </p>
                </div>
                <button
                    onClick={navigateToClusterManagement}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                >
                    <Tag className="h-4 w-4" />
                    Manage Clusters
                </button>
            </div>

            {/* Search & Filters Bar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search customers, merchant groups..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                </div>
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={clsx(
                        'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
                        showFilters || activeFilterCount > 0
                            ? 'border-blue-200 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                    )}
                >
                    <Filter className="h-4 w-4" />
                    Filters
                    {activeFilterCount > 0 && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-xs text-white">
                            {activeFilterCount}
                        </span>
                    )}
                </button>
            </div>

            {/* Filters Panel */}
            {showFilters && (
                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm animate-in slide-in-from-top-2">
                    <div className="mb-4 flex items-center justify-between">
                        <h3 className="font-semibold text-gray-900">Filter Customers</h3>
                        {activeFilterCount > 0 && (
                            <button
                                onClick={clearFilters}
                                className="text-sm text-red-600 hover:underline"
                            >
                                Clear All
                            </button>
                        )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-gray-700">Market</label>
                            <select
                                value={filterMarket}
                                onChange={(e) => setFilterMarket(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">All Markets</option>
                                {markets.map(m => (
                                    <option key={m} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="mb-1.5 block text-sm font-medium text-gray-700">Customer Type</label>
                            <select
                                value={filterType}
                                onChange={(e) => setFilterType(e.target.value)}
                                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                                <option value="">All Types</option>
                                <option value="customer">Customer</option>
                                <option value="supplier">Supplier</option>
                                <option value="both">Both</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Customer Table */}
            {loading ? (
                <div className="flex h-96 items-center justify-center">
                    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                </div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th
                                        className="cursor-pointer px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
                                        onClick={() => handleSort('customer_name')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Customer
                                            <SortIcon field="customer_name" />
                                        </div>
                                    </th>
                                    <th
                                        className="cursor-pointer px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
                                        onClick={() => handleSort('merchant_group')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Merchant Group
                                            <SortIcon field="merchant_group" />
                                        </div>
                                    </th>
                                    <th
                                        className="cursor-pointer px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-700"
                                        onClick={() => handleSort('market')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Market
                                            <SortIcon field="market" />
                                        </div>
                                    </th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Cluster
                                    </th>
                                    <th className="px-6 py-3.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Type
                                    </th>
                                    <th className="px-6 py-3.5 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">
                                        Actions
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 bg-white">
                                {filteredAndSortedCustomers.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-12 text-center">
                                            <UserCircle className="mx-auto h-12 w-12 text-gray-300" />
                                            <p className="mt-2 text-sm text-gray-500">No customers found</p>
                                            {(searchQuery || activeFilterCount > 0) && (
                                                <button
                                                    onClick={clearFilters}
                                                    className="mt-2 text-sm text-blue-600 hover:underline"
                                                >
                                                    Clear filters
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ) : (
                                    filteredAndSortedCustomers.map((customer) => (
                                        <tr
                                            key={customer.customer_id}
                                            className="hover:bg-gray-50 transition-colors"
                                        >
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-blue-200">
                                                        <UserCircle className="h-5 w-5 text-blue-600" />
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-gray-900">{customer.customer_name}</p>
                                                        {customer.bill_to && (
                                                            <p className="text-xs text-gray-500">{customer.bill_to}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <Building2 className="h-4 w-4 text-gray-400" />
                                                    <span className="text-sm text-gray-700">
                                                        {customer.merchant_group || '-'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <div className="flex items-center gap-2">
                                                    <MapPin className="h-4 w-4 text-gray-400" />
                                                    <span className="text-sm text-gray-700">
                                                        {customer.market || '-'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                {customer.cluster_label ? (
                                                    <button
                                                        onClick={navigateToClusterManagement}
                                                        className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 hover:bg-purple-200 transition-colors"
                                                    >
                                                        <Tag className="h-3 w-3" />
                                                        {customer.cluster_label}
                                                    </button>
                                                ) : (
                                                    <span className="text-sm text-gray-400">-</span>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4">
                                                <span className={clsx(
                                                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                                                    customer.customer_type === 'customer' && 'bg-green-100 text-green-700',
                                                    customer.customer_type === 'supplier' && 'bg-orange-100 text-orange-700',
                                                    customer.customer_type === 'both' && 'bg-blue-100 text-blue-700',
                                                    !customer.customer_type && 'bg-gray-100 text-gray-700'
                                                )}>
                                                    {customer.customer_type || 'customer'}
                                                </span>
                                            </td>
                                            <td className="whitespace-nowrap px-6 py-4 text-right">
                                                <button
                                                    onClick={() => openEditModal(customer)}
                                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    title="Edit customer"
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Edit Modal */}
            {editingCustomer && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                        <div className="mb-6 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-gray-900">Edit Customer</h2>
                            <button
                                onClick={closeEditModal}
                                className="p-1 text-gray-400 hover:text-gray-600 rounded"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                    Customer Name
                                </label>
                                <input
                                    type="text"
                                    value={editForm.customer_name}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, customer_name: e.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                    Market
                                </label>
                                <select
                                    value={editForm.market}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, market: e.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="">No Market</option>
                                    {markets.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                    Merchant Group
                                </label>
                                <select
                                    value={editForm.merchant_group}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, merchant_group: e.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="">No Merchant Group</option>
                                    {merchantGroups.map(mg => (
                                        <option key={mg} value={mg}>{mg}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                                    Customer Type
                                </label>
                                <select
                                    value={editForm.customer_type}
                                    onChange={(e) => setEditForm(prev => ({ ...prev, customer_type: e.target.value }))}
                                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                    <option value="customer">Customer</option>
                                    <option value="supplier">Supplier</option>
                                    <option value="both">Both</option>
                                </select>
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end gap-3">
                            <button
                                onClick={closeEditModal}
                                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveCustomer}
                                disabled={saving}
                                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                            >
                                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
