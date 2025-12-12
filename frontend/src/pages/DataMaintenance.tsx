import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
    Search, 
    Link as LinkIcon, 
    Unlink, 
    ArrowRight, 
    Check, 
    X,
    Loader2,
    Package,
    Users,
    Archive,
    Trash2,
    ChevronLeft,
    ChevronRight,
    Sparkles,
    Crown
} from 'lucide-react';
import clsx from 'clsx';

// Types
interface Product {
    product_id: number;
    item_name: string;
    product_code: string;
}

interface Customer {
    customer_id: string;
    customer_name: string;
}

interface MatchGroup {
    master_id: number | string;
    master_name: string;
    child_count: number;
    children: { id: number | string; name: string; code?: string }[];
}

interface SuggestionVariant {
    id: number | string;
    name: string;
    code?: string;
    score: number;
    selected?: boolean; // For UI selection
}

interface SuggestionGroup {
    master_id: number | string;
    master_name: string;
    suggestions: SuggestionVariant[];
}

const ITEMS_PER_PAGE = 50;

export default function DataMaintenance() {
    const [activeTab, setActiveTab] = useState<'products' | 'customers' | 'archive'>('products');
    const [archiveType, setArchiveType] = useState<'products' | 'customers'>('products');
    
    // View Mode (Manual vs Suggestions)
    const [viewMode, setViewMode] = useState<'manual' | 'suggestions'>('manual');

    // State
    const [searchTerm, setSearchTerm] = useState('');
    const [unmatchedItems, setUnmatchedItems] = useState<(Product | Customer)[]>([]);
    const [matches, setMatches] = useState<MatchGroup[]>([]);
    const [suggestions, setSuggestions] = useState<SuggestionGroup[]>([]);
    const [loading, setLoading] = useState(false);
    
    // Pagination State
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    
    // Staging State (Building a match)
    const [selectedMaster, setSelectedMaster] = useState<Product | Customer | null>(null);
    const [selectedChildren, setSelectedChildren] = useState<(Product | Customer)[]>([]);

    // Archive State
    const [selectedForArchive, setSelectedForArchive] = useState<(number | string)[]>([]);

    const fetchCount = async () => {
        try {
            const type = activeTab === 'archive' ? archiveType : activeTab;
            const rpcName = type === 'products' ? 'get_unmatched_products_count' : 'get_unmatched_customers_count';
            
            const { data, error } = await supabase.rpc(rpcName, { p_search: searchTerm || null });
            if (error) throw error;
            setTotalCount(Number(data) || 0);
        } catch (err) {
            console.error('Error fetching count:', err);
        }
    };

    const fetchUnmatched = async () => {
        setLoading(true);
        try {
            // Determine RPC based on tab. If archive, use archiveType.
            const type = activeTab === 'archive' ? archiveType : activeTab;
            const rpcName = type === 'products' ? 'get_unmatched_products' : 'get_unmatched_customers';
            
            const { data, error } = await supabase.rpc(rpcName, { 
                p_search: searchTerm || null,
                p_limit: ITEMS_PER_PAGE,
                p_offset: page * ITEMS_PER_PAGE
            });
            
            if (error) throw error;
            setUnmatchedItems(data || []);
        } catch (err) {
            console.error('Error fetching items:', err);
        } finally {
            setLoading(false);
        }
    };

    const fetchMatches = async () => {
        // Only needed for matching tabs
        if (activeTab === 'archive') return;

        try {
            const rpcName = activeTab === 'products' ? 'get_product_matches' : 'get_customer_matches';
            const { data, error } = await supabase.rpc(rpcName);
            if (error) throw error;
            setMatches(data || []);
        } catch (err) {
            console.error('Error fetching matches:', err);
        }
    };

    const fetchSuggestions = async () => {
        if (activeTab === 'archive') return;
        setLoading(true);
        try {
            const rpcName = activeTab === 'products' ? 'get_product_match_suggestions' : 'get_customer_match_suggestions';
            const { data, error } = await supabase.rpc(rpcName, { p_threshold: 0.7, p_limit: 20 });
            
            if (error) throw error;
            
            // Map to add 'selected' state
            const mapped = (data || []).map((g: any) => ({
                ...g,
                suggestions: g.suggestions.map((s: any) => ({ ...s, selected: true }))
            }));
            setSuggestions(mapped);
        } catch (err) {
            console.error('Error fetching suggestions:', err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Clear selection on tab change
        setSelectedMaster(null);
        setSelectedChildren([]);
        setSelectedForArchive([]);
        setSearchTerm('');
        setPage(0); // Reset page on tab change
        
        if (viewMode === 'suggestions') {
            fetchSuggestions();
        } else {
            fetchUnmatched();
        }
        
        fetchCount();
        fetchMatches();
    }, [activeTab, archiveType, viewMode]);

    // Re-fetch when search changes
    useEffect(() => {
        if (viewMode === 'suggestions') return; // Search doesn't apply to suggestions yet
        setPage(0); // Reset page on search
        const timeout = setTimeout(() => {
            fetchUnmatched();
            fetchCount();
        }, 300);
        return () => clearTimeout(timeout);
    }, [searchTerm]);

    // Re-fetch when page changes
    useEffect(() => {
        if (viewMode !== 'suggestions') {
            fetchUnmatched();
        }
    }, [page]);

    const handleSetMaster = (item: Product | Customer) => {
        if (selectedMaster && getId(item) === getId(selectedMaster)) {
            setSelectedMaster(null);
        } else {
            setSelectedMaster(item);
            // Remove from children if it was there
            setSelectedChildren(prev => prev.filter(c => getId(c) !== getId(item)));
        }
    };

    const handleToggleChild = (item: Product | Customer) => {
        if (selectedMaster && getId(item) === getId(selectedMaster)) return; // Can't be both master and child

        setSelectedChildren(prev => {
            const isSelected = prev.some(c => getId(c) === getId(item));
            if (isSelected) {
                return prev.filter(c => getId(c) !== getId(item));
            } else {
                return [...prev, item];
            }
        });
    };

    const handleToggleArchiveSelect = (id: number | string) => {
        setSelectedForArchive(prev => {
            if (prev.includes(id)) {
                return prev.filter(x => x !== id);
            } else {
                return [...prev, id];
            }
        });
    };

    const handleSelectAllArchive = () => {
        if (selectedForArchive.length === unmatchedItems.length) {
            setSelectedForArchive([]);
        } else {
            setSelectedForArchive(unmatchedItems.map(item => getId(item)));
        }
    };

    const handleCreateMatch = async () => {
        if (!selectedMaster || selectedChildren.length === 0) return;

        try {
            setLoading(true);
            if (activeTab === 'products') {
                await supabase.rpc('match_products', {
                    p_master_id: (selectedMaster as Product).product_id,
                    p_child_ids: selectedChildren.map(c => (c as Product).product_id)
                });
            } else {
                await supabase.rpc('match_customers', {
                    p_master_id: (selectedMaster as Customer).customer_id,
                    p_child_ids: selectedChildren.map(c => (c as Customer).customer_id)
                });
            }
            
            // Reset and Refresh
            setSelectedMaster(null);
            setSelectedChildren([]);
            await Promise.all([fetchUnmatched(), fetchCount(), fetchMatches()]);
        } catch (err) {
            console.error('Error creating match:', err);
            alert('Failed to create match');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmSuggestion = async (groupIndex: number) => {
        const group = suggestions[groupIndex];
        const selectedVariants = group.suggestions.filter(s => s.selected);
        
        if (selectedVariants.length === 0) return;

        try {
            setLoading(true);
            if (activeTab === 'products') {
                await supabase.rpc('match_products', {
                    p_master_id: group.master_id,
                    p_child_ids: selectedVariants.map(v => v.id)
                });
            } else {
                await supabase.rpc('match_customers', {
                    p_master_id: group.master_id,
                    p_child_ids: selectedVariants.map(v => v.id)
                });
            }

            // Remove this group from suggestions
            setSuggestions(prev => prev.filter((_, i) => i !== groupIndex));
            await fetchMatches(); // Update sidebar
        } catch (err) {
            console.error('Error confirming suggestion:', err);
            alert('Failed to confirm match');
        } finally {
            setLoading(false);
        }
    };

    const handleDismissSuggestion = (groupIndex: number) => {
        setSuggestions(prev => prev.filter((_, i) => i !== groupIndex));
    };

    const handleToggleSuggestionVariant = (groupIndex: number, variantIndex: number) => {
        setSuggestions(prev => {
            const newSuggestions = [...prev];
            const group = { ...newSuggestions[groupIndex] };
            const variants = [...group.suggestions];
            variants[variantIndex] = { ...variants[variantIndex], selected: !variants[variantIndex].selected };
            group.suggestions = variants;
            newSuggestions[groupIndex] = group;
            return newSuggestions;
        });
    };

    const handleSetSuggestionMaster = (groupIndex: number, variantIndex: number) => {
        setSuggestions(prev => {
            const newSuggestions = [...prev];
            const group = { ...newSuggestions[groupIndex] };
            
            // Swap
            const newMaster = group.suggestions[variantIndex];
            const oldMaster = {
                id: group.master_id,
                name: group.master_name,
                score: newMaster.score, // Inherit score or default
                selected: true
            };
            
            group.master_id = newMaster.id;
            group.master_name = newMaster.name;
            
            // Remove new master from variants list and add old master
            const newVariants = group.suggestions.filter((_, idx) => idx !== variantIndex);
            newVariants.push(oldMaster);
            
            // Sort by name (optional, but keeps UI clean)
            newVariants.sort((a, b) => a.name.localeCompare(b.name));
            
            group.suggestions = newVariants;
            newSuggestions[groupIndex] = group;
            
            return newSuggestions;
        });
    };

    const handleUnmatch = async (childId: number | string) => {
        try {
            if (activeTab === 'products') {
                await supabase.rpc('unmatch_product', { p_product_id: childId });
            } else {
                await supabase.rpc('unmatch_customer', { p_customer_id: childId });
            }
            await Promise.all([fetchUnmatched(), fetchCount(), fetchMatches()]);
        } catch (err) {
            console.error('Error unmatching:', err);
        }
    };

    const handleArchive = async () => {
        if (selectedForArchive.length === 0) return;
        if (!confirm(`Are you sure you want to archive ${selectedForArchive.length} items? They will be hidden from analytics.`)) return;

        try {
            setLoading(true);
            if (archiveType === 'products') {
                await supabase.rpc('archive_products', { p_product_ids: selectedForArchive });
            } else {
                await supabase.rpc('archive_customers', { p_customer_ids: selectedForArchive });
            }
            
            setSelectedForArchive([]);
            // Refresh data and count
            await Promise.all([fetchUnmatched(), fetchCount()]);
        } catch (err) {
            console.error('Error archiving:', err);
            alert('Failed to archive items');
        } finally {
            setLoading(false);
        }
    };

    // Helper to get ID
    const getId = (item: Product | Customer) => {
        // Safe check for product_id vs customer_id
        if ('product_id' in item) return item.product_id;
        return item.customer_id;
    };

    // Helper to get Name
    const getName = (item: Product | Customer) => {
        if ('item_name' in item) return item.item_name;
        return item.customer_name;
    };

    const isMatchMode = activeTab !== 'archive';
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Data Maintenance</h1>
                    <p className="text-gray-500">Match duplicates, consolidate data, or archive legacy records.</p>
                </div>
                
                {isMatchMode && (
                    <div className="flex bg-gray-100 p-1 rounded-lg self-start">
                        <button
                            onClick={() => setViewMode('manual')}
                            className={clsx(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                viewMode === 'manual' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <LinkIcon className="h-4 w-4" />
                            Manual Match
                        </button>
                        <button
                            onClick={() => setViewMode('suggestions')}
                            className={clsx(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2",
                                viewMode === 'suggestions' ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
                            )}
                        >
                            <Sparkles className="h-4 w-4" />
                            Suggestions
                        </button>
                    </div>
                )}
            </div>

            {/* Main Tabs */}
            <div className="flex space-x-4 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('products')}
                    className={clsx(
                        "pb-3 px-1 flex items-center gap-2 font-medium text-sm transition-colors relative",
                        activeTab === 'products' ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    <Package className="h-4 w-4" />
                    Product Matching
                    {activeTab === 'products' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('customers')}
                    className={clsx(
                        "pb-3 px-1 flex items-center gap-2 font-medium text-sm transition-colors relative",
                        activeTab === 'customers' ? "text-blue-600" : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    <Users className="h-4 w-4" />
                    Customer Matching
                    {activeTab === 'customers' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600 rounded-t-full" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('archive')}
                    className={clsx(
                        "pb-3 px-1 flex items-center gap-2 font-medium text-sm transition-colors relative",
                        activeTab === 'archive' ? "text-red-600" : "text-gray-500 hover:text-gray-700"
                    )}
                >
                    <Archive className="h-4 w-4" />
                    Bulk Archive
                    {activeTab === 'archive' && (
                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-red-600 rounded-t-full" />
                    )}
                </button>
            </div>

            {activeTab === 'archive' && (
                <div className="flex gap-2 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setArchiveType('products')}
                        className={clsx(
                            "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                            archiveType === 'products' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        Products
                    </button>
                    <button
                        onClick={() => setArchiveType('customers')}
                        className={clsx(
                            "px-3 py-1.5 text-xs font-medium rounded-md transition-all",
                            archiveType === 'customers' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
                        )}
                    >
                        Customers
                    </button>
                </div>
            )}

            {isMatchMode && viewMode === 'suggestions' ? (
                // SUGGESTIONS UI
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {loading && suggestions.length === 0 ? (
                        <div className="col-span-full flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-gray-200">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500 mb-4" />
                            <p className="text-gray-500">Scanning for fuzzy matches...</p>
                        </div>
                    ) : suggestions.length === 0 ? (
                        <div className="col-span-full flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-gray-200">
                            <Sparkles className="h-8 w-8 text-gray-300 mb-4" />
                            <p className="text-gray-900 font-medium">No suggestions found</p>
                            <p className="text-gray-500 text-sm mt-1">Try lowering the similarity threshold or check manual matching.</p>
                        </div>
                    ) : (
                        suggestions.map((group, gIdx) => (
                            <div key={gIdx} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
                                <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-bold rounded uppercase">Proposed Master</span>
                                        </div>
                                        <p className="font-semibold text-gray-900 mt-1">{group.master_name}</p>
                                    </div>
                                    <button 
                                        onClick={() => handleDismissSuggestion(gIdx)}
                                        className="text-gray-400 hover:text-gray-600 p-1"
                                    >
                                        <X className="h-5 w-5" />
                                    </button>
                                </div>
                                <div className="p-4 flex-1">
                                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Similar Items Found</p>
                                    <div className="space-y-2">
                                        {group.suggestions.map((variant, vIdx) => (
                                            <div 
                                                key={variant.id} 
                                                className={clsx(
                                                    "flex items-center p-2 rounded-lg border transition-colors cursor-pointer",
                                                    variant.selected ? "bg-blue-50 border-blue-200" : "bg-white border-gray-100 hover:border-gray-200"
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={variant.selected}
                                                    onChange={() => handleToggleSuggestionVariant(gIdx, vIdx)}
                                                    className="rounded border-gray-300 text-blue-600 mr-3"
                                                />
                                                <div className="flex-1 min-w-0" onClick={() => handleToggleSuggestionVariant(gIdx, vIdx)}>
                                                    <p className="text-sm font-medium text-gray-900 truncate">{variant.name}</p>
                                                    <div className="flex items-center gap-2 mt-0.5">
                                                        <span className="text-xs text-gray-500">{variant.code || variant.id}</span>
                                                        <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded-full">
                                                            {Math.round(variant.score * 100)}% match
                                                        </span>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleSetSuggestionMaster(gIdx, vIdx); }}
                                                    className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                    title="Set as Master"
                                                >
                                                    <Crown className="h-4 w-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                <div className="p-4 bg-gray-50 border-t border-gray-100">
                                    <button
                                        onClick={() => handleConfirmSuggestion(gIdx)}
                                        disabled={loading || !group.suggestions.some(s => s.selected)}
                                        className="w-full py-2 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                    >
                                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                        Confirm Match
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            ) : isMatchMode ? (
                // MATCHING UI (Original 3-column layout)
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    
                    {/* Left Column: Unmatched Items */}
                    <div className="lg:col-span-5 flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50">
                            <h2 className="font-semibold text-gray-900 mb-2">Unmatched Items</h2>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                                <input
                                    type="text"
                                    placeholder="Search..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                />
                            </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-2 space-y-1">
                            {loading && unmatchedItems.length === 0 ? (
                                <div className="flex justify-center p-8">
                                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                                </div>
                            ) : unmatchedItems.length === 0 ? (
                                <div className="text-center p-8 text-gray-400 text-sm">
                                    No items found
                                </div>
                            ) : (
                                unmatchedItems.map(item => {
                                    const id = getId(item);
                                    const isMaster = selectedMaster && getId(selectedMaster) === id;
                                    const isChild = selectedChildren.some(c => getId(c) === id);

                                    return (
                                        <div 
                                            key={id} 
                                            className={clsx(
                                                "flex items-center justify-between p-3 rounded-lg border transition-all cursor-pointer group",
                                                isMaster ? "bg-blue-50 border-blue-200 shadow-sm" : 
                                                isChild ? "bg-amber-50 border-amber-200" : 
                                                "bg-white border-gray-100 hover:border-gray-300 hover:bg-gray-50"
                                            )}
                                            onClick={() => handleToggleChild(item)}
                                        >
                                            <div className="flex-1 min-w-0 mr-2">
                                                <p className="text-sm font-medium text-gray-900 truncate">{getName(item)}</p>
                                                {activeTab === 'products' && (
                                                    <p className="text-xs text-gray-500 truncate">{(item as Product).product_code}</p>
                                                )}
                                            </div>
                                            <div className="flex gap-1 shrink-0">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleSetMaster(item); }}
                                                    className={clsx(
                                                        "p-1.5 rounded-md text-xs font-medium transition-colors",
                                                        isMaster 
                                                            ? "bg-blue-600 text-white"
                                                            : "bg-gray-100 text-gray-600 hover:bg-blue-100 hover:text-blue-700"
                                                    )}
                                                    title="Set as Master"
                                                >
                                                    {isMaster ? <Check className="h-3 w-3" /> : "Master"}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>

                    {/* Middle Column: Action / Staging */}
                    <div className="lg:col-span-3 flex flex-col h-[600px] bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-4">
                        <h2 className="font-semibold text-gray-900 text-center">Match Builder</h2>
                        
                        <div className="flex-1 flex flex-col gap-4">
                            {/* Selected Master */}
                            <div className="bg-white p-4 rounded-lg border border-blue-100 shadow-sm">
                                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1 block">Master</span>
                                {selectedMaster ? (
                                    <div>
                                        <p className="font-medium text-gray-900">{getName(selectedMaster)}</p>
                                        <p className="text-xs text-gray-500">{activeTab === 'products' ? (selectedMaster as Product).product_code : (selectedMaster as Customer).customer_id}</p>
                                        <button 
                                            onClick={() => setSelectedMaster(null)} 
                                            className="mt-2 text-xs text-red-600 hover:underline flex items-center gap-1"
                                        >
                                            <X className="h-3 w-3" /> Remove
                                        </button>
                                    </div>
                                ) : (
                                    <div className="h-16 border-2 border-dashed border-gray-200 rounded flex items-center justify-center text-xs text-gray-400">
                                        Select a Master from list
                                    </div>
                                )}
                            </div>

                            <div className="flex justify-center">
                                <ArrowRight className="h-5 w-5 text-gray-400 rotate-90 lg:rotate-0" />
                            </div>

                            {/* Selected Variants */}
                            <div className="bg-white p-4 rounded-lg border border-amber-100 shadow-sm flex-1 overflow-hidden flex flex-col">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-amber-600 uppercase tracking-wider">Variants ({selectedChildren.length})</span>
                                    {selectedChildren.length > 0 && (
                                        <button onClick={() => setSelectedChildren([])} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
                                    )}
                                </div>
                                
                                <div className="flex-1 overflow-y-auto space-y-2">
                                    {selectedChildren.length === 0 ? (
                                        <div className="text-center py-4 text-xs text-gray-400">
                                            Select variants to merge
                                        </div>
                                    ) : (
                                        selectedChildren.map(child => (
                                            <div key={getId(child)} className="flex items-center justify-between bg-gray-50 p-2 rounded text-sm">
                                                <span className="truncate flex-1 mr-2">{getName(child)}</span>
                                                <button onClick={() => handleToggleChild(child)} className="text-gray-400 hover:text-red-500">
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleCreateMatch}
                            disabled={!selectedMaster || selectedChildren.length === 0 || loading}
                            className={clsx(
                                "w-full py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-2 transition-all",
                                (!selectedMaster || selectedChildren.length === 0)
                                    ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                    : "bg-blue-600 text-white hover:bg-blue-700 shadow-md hover:shadow-lg"
                            )}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
                            Confirm Match
                        </button>
                    </div>

                    {/* Right Column: Existing Matches */}
                    <div className="lg:col-span-4 flex flex-col h-[600px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="p-4 border-b border-gray-100 bg-gray-50">
                            <h2 className="font-semibold text-gray-900">Existing Matches</h2>
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-2">
                            {matches.length === 0 ? (
                                <div className="text-center p-8 text-gray-400 text-sm">
                                    No matched groups yet
                                </div>
                            ) : (
                                matches.map(group => (
                                    <div key={group.master_id} className="border border-gray-100 rounded-lg overflow-hidden">
                                        <div className="bg-gray-50 p-3 flex items-center justify-between">
                                            <div>
                                                <p className="font-medium text-sm text-gray-900">{group.master_name}</p>
                                                <p className="text-xs text-gray-500">{group.child_count} variants</p>
                                            </div>
                                        </div>
                                        <div className="p-2 space-y-1">
                                            {group.children.map(child => (
                                                <div key={child.id} className="flex items-center justify-between pl-3 pr-2 py-1.5 rounded hover:bg-gray-50 text-sm group/item">
                                                    <span className="text-gray-600 truncate flex-1">{child.name}</span>
                                                    <button 
                                                        onClick={() => handleUnmatch(child.id)}
                                                        className="opacity-0 group-hover/item:opacity-100 p-1 text-gray-400 hover:text-red-600 transition-opacity"
                                                        title="Unmatch"
                                                    >
                                                        <Unlink className="h-3 w-3" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                </div>
            ) : (
                // ARCHIVE UI
                <div className="flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[600px]">
                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder={`Search ${archiveType}...`}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-500">
                                {selectedForArchive.length} selected
                            </span>
                            <button
                                onClick={handleArchive}
                                disabled={selectedForArchive.length === 0 || loading}
                                className={clsx(
                                    "px-4 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-all",
                                    selectedForArchive.length === 0
                                        ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                                        : "bg-red-600 text-white hover:bg-red-700 shadow-sm"
                                )}
                            >
                                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                Archive Selected
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                                        <input
                                            type="checkbox"
                                            checked={unmatchedItems.length > 0 && selectedForArchive.length === unmatchedItems.length}
                                            onChange={handleSelectAllArchive}
                                            className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                        />
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Item Name
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        ID / Code
                                    </th>
                                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                        Load Source
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {loading && unmatchedItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                                            <div className="flex justify-center">
                                                <Loader2 className="h-6 w-6 animate-spin text-red-500" />
                                            </div>
                                        </td>
                                    </tr>
                                ) : unmatchedItems.length === 0 ? (
                                    <tr>
                                        <td colSpan={4} className="px-6 py-12 text-center text-sm text-gray-500">
                                            No unmatched items found
                                        </td>
                                    </tr>
                                ) : (
                                    unmatchedItems.map(item => {
                                        const id = getId(item);
                                        const isSelected = selectedForArchive.includes(id);
                                        return (
                                            <tr 
                                                key={id} 
                                                className={clsx(
                                                    "hover:bg-gray-50 transition-colors cursor-pointer",
                                                    isSelected && "bg-red-50 hover:bg-red-100"
                                                )}
                                                onClick={() => handleToggleArchiveSelect(id)}
                                            >
                                                <td className="px-6 py-4 whitespace-nowrap">
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => handleToggleArchiveSelect(id)}
                                                        className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                                    {getName(item)}
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    {activeTab === 'archive' && archiveType === 'products' 
                                                        ? (item as Product).product_code 
                                                        : (item as Customer).customer_id
                                                    }
                                                </td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    System
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 flex items-center justify-between sm:px-6">
                        <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                            <div>
                                <p className="text-sm text-gray-700">
                                    Showing <span className="font-medium">{page * ITEMS_PER_PAGE + 1}</span> to <span className="font-medium">{Math.min((page + 1) * ITEMS_PER_PAGE, totalCount)}</span> of{' '}
                                    <span className="font-medium">{totalCount}</span> results
                                </p>
                            </div>
                            <div>
                                <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                                    <button
                                        onClick={() => setPage(p => Math.max(0, p - 1))}
                                        disabled={page === 0}
                                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                                    >
                                        <span className="sr-only">Previous</span>
                                        <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                                    </button>
                                    <div className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
                                        Page {page + 1} of {totalPages || 1}
                                    </div>
                                    <button
                                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                                        disabled={page >= totalPages - 1}
                                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400"
                                    >
                                        <span className="sr-only">Next</span>
                                        <ChevronRight className="h-5 w-5" aria-hidden="true" />
                                    </button>
                                </nav>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
