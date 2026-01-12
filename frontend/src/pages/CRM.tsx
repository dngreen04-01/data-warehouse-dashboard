
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
    Loader2, MessageSquare, User, Calendar, Tag, AlertCircle,
    Archive, CheckSquare, Plus, X, Clock, Trash2, RefreshCw
} from 'lucide-react';
import { format, isToday, isPast, isFuture, addDays } from 'date-fns';

// --- Types ---
interface InteractionItem {
    item_id: string;
    interaction_id: string;
    customer_name_raw: string;
    product_mention: string;
    activity_type: string;
    notes: string;
    sentiment: 'Positive' | 'Negative' | 'Neutral';
    action_required: boolean;
    created_at: string;
    author_email: string;
    interaction_summary: string;
    interaction_archived: boolean;
}

interface CRMTask {
    task_id: string;
    description: string;
    due_date: string;
    is_complete: boolean;
    created_at: string;
    source_item_id?: string;
}

// --- Main Component ---
export default function CRM() {
    const [activeTab, setActiveTab] = useState<'insights' | 'tasks'>('insights');
    const [refreshTrigger, setRefreshTrigger] = useState(0); // Simple way to reload data

    const refreshData = () => setRefreshTrigger(prev => prev + 1);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold tracking-tight text-gray-900">CRM & Tasks</h1>
                <p className="text-sm text-gray-500">Manage email insights and follow-up actions.</p>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
                <nav className="-mb-px flex space-x-8" aria-label="Tabs">
                    <button
                        onClick={() => setActiveTab('insights')}
                        className={`${activeTab === 'insights'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center gap-2`}
                    >
                        <MessageSquare className="h-4 w-4" />
                        Email Insights
                    </button>
                    <button
                        onClick={() => setActiveTab('tasks')}
                        className={`${activeTab === 'tasks'
                            ? 'border-blue-500 text-blue-600'
                            : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                            } whitespace-nowrap border-b-2 py-4 px-1 text-sm font-medium flex items-center gap-2`}
                    >
                        <CheckSquare className="h-4 w-4" />
                        To-Do List
                    </button>
                </nav>
            </div>

            {/* Content Area */}
            <div className="mt-6">
                {activeTab === 'insights' ? (
                    <InsightsView key={refreshTrigger} onDataChange={refreshData} />
                ) : (
                    <TasksView key={refreshTrigger} />
                )}
            </div>
        </div>
    );
}

// --- Insights Tab ---
function InsightsView({ onDataChange }: { onDataChange: () => void }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [items, setItems] = useState<InteractionItem[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [sentimentFilter, setSentimentFilter] = useState('All');
    const [createTaskItem, setCreateTaskItem] = useState<InteractionItem | null>(null); // Modal state

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .schema('crm')
                .from('interaction_items')
                .select(`
                    *,
                    interactions:interaction_id!inner (
                        author_email,
                        summary,
                        archived
                    )
                `)
                .eq('interactions.archived', false) // Only show non-archived
                .order('created_at', { ascending: false });

            if (fetchError) throw fetchError;

            const formatted = (data || []).map((item: any) => ({
                ...item,
                author_email: item.interactions?.author_email,
                interaction_summary: item.interactions?.summary,
                interaction_archived: item.interactions?.archived
            }));

            setItems(formatted);
        } catch (err) {
            console.error('Error fetching insights:', err);
            setError(err instanceof Error ? err.message : 'Failed to load CRM insights. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleArchive = async (interactionId: string) => {
        try {
            const { error } = await supabase
                .schema('crm')
                .from('interactions')
                .update({ archived: true })
                .eq('interaction_id', interactionId);

            if (error) throw error;
            onDataChange(); // Refresh parent to trigger reload (or manually filter locally)
            setItems(prev => prev.filter(i => i.interaction_id !== interactionId)); // Optimistic update
        } catch (error) {
            console.error('Error archiving:', error);
            alert('Failed to archive item.');
        }
    };

    const filteredItems = items.filter(item => {
        const matchesSearch = item.customer_name_raw.toLowerCase().includes(searchTerm.toLowerCase())
            || item.notes?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesSentiment = sentimentFilter === 'All' || item.sentiment === sentimentFilter;
        return matchesSearch && matchesSentiment;
    });

    return (
        <div className="space-y-6">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
                <input
                    type="text"
                    placeholder="Search insights..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <select
                    value={sentimentFilter}
                    onChange={(e) => setSentimentFilter(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                    <option value="All">All Sentiments</option>
                    <option value="Positive">Positive</option>
                    <option value="Negative">Negative</option>
                    <option value="Neutral">Neutral</option>
                </select>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm" role="alert">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <AlertCircle className="h-5 w-5 text-red-600" />
                            <div>
                                <p className="font-medium text-red-800">Failed to load insights</p>
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

            {/* List */}
            {loading ? (
                <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" /></div>
            ) : error ? null : filteredItems.length === 0 ? (
                <div className="text-center p-12 text-gray-500">No active insights found.</div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {filteredItems.map(item => (
                        <InsightCard
                            key={item.item_id}
                            item={item}
                            onArchive={() => handleArchive(item.interaction_id)}
                            onCreateTask={() => setCreateTaskItem(item)}
                        />
                    ))}
                </div>
            )}

            {/* Create Task Modal */}
            {createTaskItem && (
                <CreateTaskModal
                    item={createTaskItem}
                    onClose={() => setCreateTaskItem(null)}
                    onSuccess={() => { setCreateTaskItem(null); alert("Task Created!"); }}
                />
            )}
        </div>
    );
}

// --- Tasks Tab ---
function TasksView() {
    const [tasks, setTasks] = useState<CRMTask[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetchTasks();
    }, []);

    const fetchTasks = async () => {
        setLoading(true);
        setError(null);
        try {
            const { data, error: fetchError } = await supabase
                .schema('crm')
                .from('tasks')
                .select('*')
                .order('is_complete', { ascending: true }) // Incomplete first
                .order('due_date', { ascending: true });   // Urgent first

            if (fetchError) throw fetchError;
            setTasks(data || []);
        } catch (err) {
            console.error('Error fetching tasks:', err);
            setError(err instanceof Error ? err.message : 'Failed to load tasks. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const toggleComplete = async (task: CRMTask) => {
        const newValue = !task.is_complete;
        // Optimistic update
        setTasks(prev => prev.map(t => t.task_id === task.task_id ? { ...t, is_complete: newValue } : t));

        await supabase.schema('crm').from('tasks').update({ is_complete: newValue }).eq('task_id', task.task_id);
    };

    const deleteTask = async (taskId: string) => {
        if (!confirm('Delete this task?')) return;
        setTasks(prev => prev.filter(t => t.task_id !== taskId));
        await supabase.schema('crm').from('tasks').delete().eq('task_id', taskId);
    };

    const overdueTasks = tasks.filter(t => !t.is_complete && t.due_date && isPast(new Date(t.due_date)) && !isToday(new Date(t.due_date)));
    const todayTasks = tasks.filter(t => !t.is_complete && t.due_date && isToday(new Date(t.due_date)));
    const futureTasks = tasks.filter(t => !t.is_complete && (!t.due_date || (isFuture(new Date(t.due_date)) && !isToday(new Date(t.due_date)))));
    const completedTasks = tasks.filter(t => t.is_complete);

    if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin text-blue-600" /></div>;

    if (error) {
        return (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm" role="alert">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="h-5 w-5 text-red-600" />
                        <div>
                            <p className="font-medium text-red-800">Failed to load tasks</p>
                            <p className="text-sm text-red-600">{error}</p>
                        </div>
                    </div>
                    <button
                        onClick={() => fetchTasks()}
                        className="flex items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-200 transition-colors"
                    >
                        <RefreshCw className="h-4 w-4" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <TaskListSection title="Overdue" tasks={overdueTasks} color="red" onToggle={toggleComplete} onDelete={deleteTask} />
            <TaskListSection title="Due Today" tasks={todayTasks} color="amber" onToggle={toggleComplete} onDelete={deleteTask} />
            <TaskListSection title="Upcoming" tasks={futureTasks} color="blue" onToggle={toggleComplete} onDelete={deleteTask} />

            {completedTasks.length > 0 && (
                <div className="opacity-60 grayscale">
                    <TaskListSection title="Completed" tasks={completedTasks} color="gray" onToggle={toggleComplete} onDelete={deleteTask} />
                </div>
            )}

            {tasks.length === 0 && <p className="text-center text-gray-500 py-12">No tasks yet. Create one from the Insights tab!</p>}
        </div>
    );
}

function TaskListSection({ title, tasks, color, onToggle, onDelete }: any) {
    if (tasks.length === 0) return null;

    const colorClasses: any = {
        red: 'text-red-700 bg-red-50 border-red-100',
        amber: 'text-amber-700 bg-amber-50 border-amber-100',
        blue: 'text-blue-700 bg-blue-50 border-blue-100',
        gray: 'text-gray-700 bg-gray-50 border-gray-100',
    };

    return (
        <div className="space-y-3">
            <h3 className={`text-sm font-bold uppercase tracking-wide ${colorClasses[color].split(' ')[0]}`}>{title}</h3>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {tasks.map((task: CRMTask) => (
                    <div key={task.task_id} className="flex items-center gap-4 p-4 hover:bg-gray-50 group">
                        <button
                            onClick={() => onToggle(task)}
                            className={`flex-shrink-0 h-5 w-5 rounded border ${task.is_complete ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 text-transparent'} flex items-center justify-center transition-colors`}
                        >
                            <CheckSquare className="h-3.5 w-3.5" />
                        </button>
                        <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium text-gray-900 ${task.is_complete ? 'line-through text-gray-500' : ''}`}>
                                {task.description}
                            </p>
                            {task.due_date && (
                                <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                                    <Clock className="h-3 w-3" />
                                    {format(new Date(task.due_date), 'MMM d')}
                                </p>
                            )}
                        </div>
                        <button onClick={() => onDelete(task.task_id)} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

// --- Components ---

function InsightCard({ item, onArchive, onCreateTask }: { item: InteractionItem, onArchive: () => void, onCreateTask: () => void }) {
    const sentimentColor =
        item.sentiment === 'Positive' ? 'text-green-600 bg-green-50 border-green-200' :
            item.sentiment === 'Negative' ? 'text-red-600 bg-red-50 border-red-200' :
                'text-gray-600 bg-gray-50 border-gray-200';

    return (
        <div className={`flex flex-col rounded-xl border bg-white p-5 shadow-sm hover:shadow-md transition-shadow ${item.action_required ? 'border-amber-400 ring-1 ring-amber-100' : 'border-gray-200'}`}>
            <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-400" />
                    <span className="font-semibold text-gray-900 truncate max-w-[150px]" title={item.customer_name_raw}>
                        {item.customer_name_raw}
                    </span>
                </div>
                <div className="flex gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${sentimentColor}`}>
                        {item.sentiment}
                    </span>
                </div>
            </div>

            <p className="text-sm text-gray-600 mb-4 flex-1 line-clamp-4 leading-relaxed">
                "{item.notes}"
            </p>

            <div className="flex gap-2 mb-4">
                {item.action_required && (
                    <button
                        onClick={onCreateTask}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Create Task
                    </button>
                )}
                <button
                    onClick={onArchive}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Archive/Delete"
                >
                    <Archive className="h-4 w-4" />
                </button>
            </div>

            <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-1.5">
                    <Tag className="h-3 w-3" />
                    <span>{item.activity_type}</span>
                </div>
                <div className="flex items-center gap-1.5" title={item.created_at}>
                    <Calendar className="h-3 w-3" />
                    <span>{format(new Date(item.created_at), 'MMM d')}</span>
                </div>
            </div>
        </div>
    );
}

function CreateTaskModal({ item, onClose, onSuccess }: { item: InteractionItem, onClose: () => void, onSuccess: () => void }) {
    const notesSuffix = item.notes ? `${item.notes.substring(0, 50)}...` : '';
    const [desc, setDesc] = useState(`Follow up with ${item.customer_name_raw}${notesSuffix ? ': ' + notesSuffix : ''}`);
    const [date, setDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const { error } = await supabase.schema('crm').from('tasks').insert({
                description: desc,
                due_date: new Date(date).toISOString(),
                source_item_id: item.item_id
            });
            if (error) throw error;
            onSuccess();
        } catch (err) {
            console.error(err);
            alert("Failed to create task");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                    <h3 className="font-semibold text-gray-900">Create Task</h3>
                    <button onClick={onClose}><X className="h-5 w-5 text-gray-400 hover:text-gray-600" /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            required
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                            rows={3}
                            value={desc}
                            onChange={e => setDesc(e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                        <input
                            type="date"
                            required
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                            value={date}
                            onChange={e => setDate(e.target.value)}
                        />
                    </div>
                    <div className="pt-2 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">Cancel</button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                        >
                            {loading ? 'Creating...' : 'Create Task'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
