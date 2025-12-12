import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, Trash2, Check, X, Users, Package, Pencil, Search } from 'lucide-react';
import clsx from 'clsx';

interface Cluster {
    cluster_id: number;
    cluster_label: string;
    cluster_type: string;
    member_count: number;
}

interface Member {
    id: string;
    name: string;
}

interface SearchResult {
    id: string;
    name: string;
    current_cluster?: string;
}

export default function ClusterManagement() {
    const [activeTab, setActiveTab] = useState<'customer' | 'product'>('customer');
    const [clusters, setClusters] = useState<Cluster[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedCluster, setSelectedCluster] = useState<Cluster | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [newClusterName, setNewClusterName] = useState('');
    const [isCreating, setIsCreating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);

    // Rename state
    const [editingClusterId, setEditingClusterId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');

    useEffect(() => {
        fetchClusters();
        setSelectedCluster(null);
        setMembers([]);
        setSearchQuery('');
        setSearchResults([]);
    }, [activeTab]);

    useEffect(() => {
        if (selectedCluster) {
            fetchMembers(selectedCluster.cluster_id);
        } else {
            setMembers([]);
        }
    }, [selectedCluster]);

    const fetchClusters = async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_clusters_by_type', {
                p_type: activeTab
            });
            if (error) throw error;
            setClusters(data || []);
        } catch (error) {
            console.error('Error fetching clusters:', error);
            // Fallback to direct query if RPC doesn't exist yet
            const { data } = await supabase
                .from('dim_cluster')
                .select('*')
                .order('cluster_label');
            setClusters((data || []).map(c => ({ ...c, member_count: 0 })));
        } finally {
            setLoading(false);
        }
    };

    const fetchMembers = async (clusterId: number) => {
        setMembersLoading(true);
        try {
            const { data, error } = await supabase.rpc('get_cluster_members', {
                p_cluster_id: clusterId,
                p_type: activeTab
            });
            if (error) throw error;
            setMembers(data || []);
        } catch (error) {
            console.error('Error fetching members:', error);
            setMembers([]);
        } finally {
            setMembersLoading(false);
        }
    };

    const createCluster = async () => {
        if (!newClusterName.trim()) return;
        try {
            const { error } = await supabase.rpc('create_cluster', {
                p_label: newClusterName.trim(),
                p_type: activeTab
            });
            if (error) throw error;
            setNewClusterName('');
            setIsCreating(false);
            fetchClusters();
        } catch (error) {
            console.error('Error creating cluster:', error);
            alert('Failed to create cluster. Please try again.');
        }
    };

    const renameCluster = async (clusterId: number) => {
        if (!editingName.trim()) return;
        try {
            const { error } = await supabase.rpc('rename_cluster', {
                p_cluster_id: clusterId,
                p_new_label: editingName.trim()
            });
            if (error) throw error;
            setEditingClusterId(null);
            setEditingName('');
            fetchClusters();
            // Update selected cluster if it's the one being renamed
            if (selectedCluster?.cluster_id === clusterId) {
                setSelectedCluster({ ...selectedCluster, cluster_label: editingName.trim() });
            }
        } catch (error) {
            console.error('Error renaming cluster:', error);
            alert('Failed to rename cluster. Please try again.');
        }
    };

    const deleteCluster = async (id: number) => {
        if (!confirm('Are you sure? This will remove all members from this cluster.')) return;
        try {
            const { error } = await supabase.rpc('delete_cluster', {
                p_cluster_id: id
            });
            if (error) throw error;
            if (selectedCluster?.cluster_id === id) setSelectedCluster(null);
            fetchClusters();
        } catch (error) {
            console.error('Error deleting cluster:', error);
            alert('Failed to delete cluster. Please try again.');
        }
    };

    const addMember = async (entityId: string) => {
        if (!selectedCluster) return;
        try {
            const { error } = await supabase.rpc('manage_cluster_member', {
                p_type: activeTab,
                p_action: 'add',
                p_cluster_id: selectedCluster.cluster_id,
                p_entity_id: entityId
            });
            if (error) throw error;
            fetchMembers(selectedCluster.cluster_id);
            fetchClusters(); // Refresh counts
            setSearchQuery('');
            setSearchResults([]);
        } catch (error) {
            console.error('Error adding member:', error);
            alert('Failed to add member. Please try again.');
        }
    };

    const removeMember = async (entityId: string) => {
        if (!selectedCluster) return;
        try {
            const { error } = await supabase.rpc('manage_cluster_member', {
                p_type: activeTab,
                p_action: 'remove',
                p_cluster_id: selectedCluster.cluster_id,
                p_entity_id: entityId
            });
            if (error) throw error;
            fetchMembers(selectedCluster.cluster_id);
            fetchClusters(); // Refresh counts
        } catch (error) {
            console.error('Error removing member:', error);
            alert('Failed to remove member. Please try again.');
        }
    };

    const searchEntities = async (query: string) => {
        setSearchQuery(query);
        if (query.length < 2) {
            setSearchResults([]);
            return;
        }

        setSearchLoading(true);
        try {
            if (activeTab === 'customer') {
                // Search customers and get their current cluster
                const { data } = await supabase
                    .from('dim_customer')
                    .select('customer_id, customer_name')
                    .eq('archived', false)
                    .ilike('customer_name', `%${query}%`)
                    .limit(10);

                // Get cluster assignments for these customers
                const customerIds = (data || []).map(c => c.customer_id);
                const { data: clusterData } = await supabase
                    .from('dim_customer_cluster')
                    .select('customer_id, cluster_id')
                    .in('customer_id', customerIds);

                const clusterMap = new Map((clusterData || []).map(cc => [cc.customer_id, cc.cluster_id]));
                const clusterLabels = new Map(clusters.map(c => [c.cluster_id, c.cluster_label]));

                setSearchResults((data || []).map(c => ({
                    id: c.customer_id,
                    name: c.customer_name,
                    current_cluster: clusterMap.has(c.customer_id)
                        ? clusterLabels.get(clusterMap.get(c.customer_id)!) || 'Unknown'
                        : undefined
                })));
            } else {
                // Search products and get their current cluster
                const { data } = await supabase
                    .from('dim_product')
                    .select('product_id, item_name')
                    .eq('archived', false)
                    .ilike('item_name', `%${query}%`)
                    .limit(10);

                // Get cluster assignments for these products
                const productIds = (data || []).map(p => p.product_id);
                const { data: clusterData } = await supabase
                    .from('dim_product_cluster')
                    .select('product_id, cluster_id')
                    .in('product_id', productIds);

                const clusterMap = new Map((clusterData || []).map(pc => [pc.product_id, pc.cluster_id]));
                const clusterLabels = new Map(clusters.map(c => [c.cluster_id, c.cluster_label]));

                setSearchResults((data || []).map(p => ({
                    id: String(p.product_id),
                    name: p.item_name,
                    current_cluster: clusterMap.has(p.product_id)
                        ? clusterLabels.get(clusterMap.get(p.product_id)!) || 'Unknown'
                        : undefined
                })));
            }
        } catch (error) {
            console.error('Error searching:', error);
            setSearchResults([]);
        } finally {
            setSearchLoading(false);
        }
    };

    const startEditing = (cluster: Cluster) => {
        setEditingClusterId(cluster.cluster_id);
        setEditingName(cluster.cluster_label);
    };

    const cancelEditing = () => {
        setEditingClusterId(null);
        setEditingName('');
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-gray-900">Cluster Management</h1>
                    <p className="text-sm text-gray-500">Organize your Customers and Products into custom groups.</p>
                </div>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8">
                    <button
                        onClick={() => setActiveTab('customer')}
                        className={clsx(
                            activeTab === 'customer'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                            'whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center gap-2'
                        )}
                    >
                        <Users className="h-4 w-4" />
                        Customer Clusters
                    </button>
                    <button
                        onClick={() => setActiveTab('product')}
                        className={clsx(
                            activeTab === 'product'
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                            'whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center gap-2'
                        )}
                    >
                        <Package className="h-4 w-4" />
                        Product Clusters
                    </button>
                </nav>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Cluster List */}
                <div className="lg:col-span-1 rounded-xl border bg-white p-4 shadow-sm h-[600px] flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-gray-900">
                            {activeTab === 'customer' ? 'Customer' : 'Product'} Clusters
                        </h3>
                        <button
                            onClick={() => setIsCreating(true)}
                            className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                            title="Create new cluster"
                        >
                            <Plus className="h-5 w-5" />
                        </button>
                    </div>

                    {isCreating && (
                        <div className="mb-4 flex gap-2">
                            <input
                                autoFocus
                                type="text"
                                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="New Cluster Name"
                                value={newClusterName}
                                onChange={(e) => setNewClusterName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') createCluster();
                                    if (e.key === 'Escape') {
                                        setIsCreating(false);
                                        setNewClusterName('');
                                    }
                                }}
                            />
                            <button
                                onClick={createCluster}
                                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            >
                                <Check className="h-4 w-4" />
                            </button>
                            <button
                                onClick={() => {
                                    setIsCreating(false);
                                    setNewClusterName('');
                                }}
                                className="p-2 text-gray-500 hover:bg-gray-50 rounded-lg transition-colors"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto space-y-2">
                        {loading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                            </div>
                        ) : clusters.length === 0 ? (
                            <div className="text-center py-8 text-gray-500">
                                <Package className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                                <p className="text-sm">No clusters yet</p>
                                <button
                                    onClick={() => setIsCreating(true)}
                                    className="mt-2 text-sm text-blue-600 hover:underline"
                                >
                                    Create your first cluster
                                </button>
                            </div>
                        ) : (
                            clusters.map(cluster => (
                                <div
                                    key={cluster.cluster_id}
                                    className={clsx(
                                        "p-3 rounded-lg cursor-pointer flex items-center justify-between group transition-all",
                                        selectedCluster?.cluster_id === cluster.cluster_id
                                            ? "bg-blue-50 border-blue-200 border"
                                            : "hover:bg-gray-50 border border-transparent"
                                    )}
                                >
                                    {editingClusterId === cluster.cluster_id ? (
                                        <div className="flex-1 flex gap-2">
                                            <input
                                                autoFocus
                                                type="text"
                                                className="flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') renameCluster(cluster.cluster_id);
                                                    if (e.key === 'Escape') cancelEditing();
                                                }}
                                            />
                                            <button
                                                onClick={() => renameCluster(cluster.cluster_id)}
                                                className="p-1 text-green-600 hover:bg-green-50 rounded"
                                            >
                                                <Check className="h-4 w-4" />
                                            </button>
                                            <button
                                                onClick={cancelEditing}
                                                className="p-1 text-gray-500 hover:bg-gray-50 rounded"
                                            >
                                                <X className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div
                                                className="flex-1"
                                                onClick={() => setSelectedCluster(cluster)}
                                            >
                                                <span className="text-sm font-medium text-gray-900">
                                                    {cluster.cluster_label}
                                                </span>
                                                <span className="ml-2 text-xs text-gray-500">
                                                    ({cluster.member_count || 0})
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        startEditing(cluster);
                                                    }}
                                                    className="p-1 text-gray-400 hover:text-blue-600 rounded"
                                                    title="Rename cluster"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deleteCluster(cluster.cluster_id);
                                                    }}
                                                    className="p-1 text-gray-400 hover:text-red-600 rounded"
                                                    title="Delete cluster"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Cluster Details */}
                <div className="lg:col-span-2 rounded-xl border bg-white p-6 shadow-sm h-[600px] flex flex-col">
                    {selectedCluster ? (
                        <>
                            <div className="mb-6 flex items-center justify-between border-b pb-4">
                                <div>
                                    <h2 className="text-lg font-bold text-gray-900">{selectedCluster.cluster_label}</h2>
                                    <p className="text-sm text-gray-500">
                                        {members.length} {activeTab === 'customer' ? 'Customers' : 'Products'}
                                    </p>
                                </div>
                            </div>

                            {/* Search / Add */}
                            <div className="mb-4 relative">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                    <input
                                        type="text"
                                        className="w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                        placeholder={`Search ${activeTab}s to add...`}
                                        value={searchQuery}
                                        onChange={(e) => searchEntities(e.target.value)}
                                    />
                                    {searchLoading && (
                                        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
                                    )}
                                </div>
                                {searchResults.length > 0 && (
                                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
                                        {searchResults.map((result) => (
                                            <button
                                                key={result.id}
                                                onClick={() => addMember(result.id)}
                                                className="w-full text-left px-4 py-3 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between"
                                            >
                                                <span className="font-medium text-gray-900">{result.name}</span>
                                                {result.current_cluster && (
                                                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                                                        Currently: {result.current_cluster}
                                                    </span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Member List */}
                            <div className="flex-1 overflow-y-auto">
                                {membersLoading ? (
                                    <div className="flex items-center justify-center py-8">
                                        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                                    </div>
                                ) : members.length === 0 ? (
                                    <div className="text-center py-8 text-gray-500">
                                        <Users className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                                        <p className="text-sm">No members in this cluster</p>
                                        <p className="text-xs text-gray-400 mt-1">
                                            Search above to add {activeTab}s
                                        </p>
                                    </div>
                                ) : (
                                    <table className="min-w-full divide-y divide-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Name
                                                </th>
                                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                    Action
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white divide-y divide-gray-200">
                                            {members.map(member => (
                                                <tr key={member.id} className="hover:bg-gray-50">
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                        {member.name}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                                                        <button
                                                            onClick={() => removeMember(member.id)}
                                                            className="text-red-600 hover:text-red-900 font-medium"
                                                        >
                                                            Remove
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex h-full items-center justify-center text-gray-500">
                            <div className="text-center">
                                <Package className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                                <p className="font-medium">Select a cluster to view details</p>
                                <p className="text-sm text-gray-400 mt-1">
                                    Or create a new one using the + button
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
