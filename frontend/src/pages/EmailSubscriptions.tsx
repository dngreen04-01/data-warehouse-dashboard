import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2, Plus, Trash2, Mail, Send, Calendar } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001';

interface Subscription {
    id: string;
    email: string;
    report_type: 'short' | 'detailed';
    is_active: boolean;
    created_at: string;
}

interface WeekOption {
    label: string;
    startDate: string;
    endDate: string;
}

function generateWeekOptions(): WeekOption[] {
    const options: WeekOption[] = [];
    const today = new Date();

    // Find last Monday (start of previous completed week)
    const lastMonday = new Date(today);
    lastMonday.setDate(today.getDate() - today.getDay() - 6); // Go back to previous Monday

    // Generate 12 weeks
    for (let i = 0; i < 12; i++) {
        const weekStart = new Date(lastMonday);
        weekStart.setDate(lastMonday.getDate() - (i * 7));

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const label = `Week of ${weekStart.toLocaleDateString('en-NZ', { month: 'short', day: 'numeric', year: 'numeric' })}`;

        options.push({
            label,
            startDate: weekStart.toISOString().split('T')[0],
            endDate: weekEnd.toISOString().split('T')[0],
        });
    }

    return options;
}

export default function EmailSubscriptions() {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
    const [loading, setLoading] = useState(true);
    const [newEmail, setNewEmail] = useState('');
    const [newType, setNewType] = useState<'short' | 'detailed'>('short');
    const [adding, setAdding] = useState(false);
    const [sendingId, setSendingId] = useState<string | null>(null);

    // On-demand sending state
    const [sendingOnDemand, setSendingOnDemand] = useState(false);
    const [selectedWeek, setSelectedWeek] = useState<string>('0');
    const [onDemandEmail, setOnDemandEmail] = useState<string>('');
    const [onDemandType, setOnDemandType] = useState<'short' | 'detailed'>('short');
    const [customEmail, setCustomEmail] = useState('');

    const weekOptions = useMemo(() => generateWeekOptions(), []);

    useEffect(() => {
        fetchSubscriptions();
    }, []);

    async function fetchSubscriptions() {
        try {
            setLoading(true);
            const { data, error } = await supabase.rpc('get_email_subscriptions');
            if (error) throw error;
            setSubscriptions(data || []);
        } catch (error) {
            console.error('Error fetching subscriptions:', error);
        } finally {
            setLoading(false);
        }
    }

    async function handleAdd(e: React.FormEvent) {
        e.preventDefault();
        if (!newEmail) return;

        try {
            setAdding(true);
            const { error } = await supabase.rpc('add_email_subscription', {
                p_email: newEmail,
                p_report_type: newType,
            });

            if (error) throw error;

            setNewEmail('');
            setNewType('short');
            fetchSubscriptions();
        } catch (error) {
            console.error('Error adding subscription:', error);
            alert('Failed to add subscription');
        } finally {
            setAdding(false);
        }
    }

    async function toggleActive(id: string, currentStatus: boolean) {
        try {
            const { error } = await supabase.rpc('toggle_email_subscription', {
                p_id: id,
                p_is_active: !currentStatus,
            });
            if (error) throw error;

            setSubscriptions(subs =>
                subs.map(s => s.id === id ? { ...s, is_active: !currentStatus } : s)
            );
        } catch (error) {
            console.error('Error toggling status:', error);
        }
    }

    async function handleDelete(id: string) {
        if (!confirm('Are you sure you want to delete this subscription?')) return;

        try {
            const { error } = await supabase.rpc('delete_email_subscription', {
                p_id: id
            });
            if (error) throw error;

            setSubscriptions(subs => subs.filter(s => s.id !== id));
        } catch (error) {
            console.error('Error deleting subscription:', error);
        }
    }

    async function triggerQueueProcessing() {
        try {
            await fetch(`${API_BASE}/api/process-report-queue`, { method: 'POST' });
        } catch (error) {
            console.warn('Could not trigger immediate processing:', error);
        }
    }

    async function handleSend(email: string, reportType: string, id: string) {
        try {
            setSendingId(id);
            const { error } = await supabase.rpc('queue_instant_report', {
                p_email: email,
                p_report_type: reportType,
            });
            if (error) throw error;
            await triggerQueueProcessing();
            alert(`Report sent to ${email}!`);
        } catch (error) {
            console.error('Error queuing report:', error);
            alert('Failed to queue report.');
        } finally {
            setSendingId(null);
        }
    }

    async function handleOnDemandSend(e: React.FormEvent) {
        e.preventDefault();
        const email = onDemandEmail === 'custom' ? customEmail : onDemandEmail;
        if (!email) {
            alert('Please select or enter a recipient email.');
            return;
        }

        const week = weekOptions[parseInt(selectedWeek)];
        if (!week) {
            alert('Please select a week.');
            return;
        }

        try {
            setSendingOnDemand(true);
            const { error } = await supabase.rpc('queue_instant_report', {
                p_email: email,
                p_report_type: onDemandType,
                p_start_date: week.startDate,
                p_end_date: week.endDate,
            });
            if (error) throw error;
            await triggerQueueProcessing();
            alert(`${onDemandType === 'short' ? 'Short' : 'Detailed'} report for ${week.label} sent to ${email}!`);
        } catch (error) {
            console.error('Error queuing on-demand report:', error);
            alert('Failed to queue report.');
        } finally {
            setSendingOnDemand(false);
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Email Subscriptions</h1>
                    <p className="mt-1 text-sm text-gray-500">Manage recipients for the weekly sales performance report.</p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Add New Recipient</h3>
                <form onSubmit={handleAdd} className="flex gap-4 items-end">
                    <div className="flex-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Mail className="h-5 w-5 text-gray-400" />
                            </div>
                            <input
                                type="email"
                                required
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                className="block w-full pl-10 sm:text-sm border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                                placeholder="colleague@example.com"
                            />
                        </div>
                    </div>
                    <div className="w-48">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
                        <select
                            value={newType}
                            onChange={(e) => setNewType(e.target.value as 'short' | 'detailed')}
                            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="short">Short Summary</option>
                            <option value="detailed">Detailed Summary</option>
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={adding}
                        className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {adding ? <Loader2 className="animate-spin h-5 w-5" /> : <Plus className="h-5 w-5 mr-2" />}
                        Add
                    </button>
                </form>
            </div>

            <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
                {loading ? (
                    <div className="p-12 flex justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : (
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created At</th>
                                <th scope="col" className="relative px-6 py-3"><span className="sr-only">Actions</span></th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {subscriptions.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                                        No subscriptions found. Add one above.
                                    </td>
                                </tr>
                            ) : (
                                subscriptions.map((sub) => (
                                    <tr key={sub.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{sub.email}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">{sub.report_type}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <button
                                                onClick={() => toggleActive(sub.id, sub.is_active)}
                                                className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${sub.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                                            >
                                                {sub.is_active ? 'Active' : 'Inactive'}
                                            </button>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {new Date(sub.created_at).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                            <button
                                                onClick={() => handleSend(sub.email, sub.report_type, sub.id)}
                                                className="text-blue-600 hover:text-blue-900 mr-4"
                                                title="Send Last Week's Report Now"
                                                disabled={sendingId === sub.id}
                                            >
                                                {sendingId === sub.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                                            </button>
                                            <button onClick={() => handleDelete(sub.id)} className="text-red-600 hover:text-red-900">
                                                <Trash2 className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {/* On-Demand Report Sender */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Send Report On Demand</h3>
                <p className="text-sm text-gray-500 mb-4">Send a report for any week to any recipient.</p>
                <form onSubmit={handleOnDemandSend} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Week</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Calendar className="h-5 w-5 text-gray-400" />
                            </div>
                            <select
                                value={selectedWeek}
                                onChange={(e) => setSelectedWeek(e.target.value)}
                                className="block w-full pl-10 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                            >
                                {weekOptions.map((week, idx) => (
                                    <option key={idx} value={idx}>{week.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Recipient</label>
                        <select
                            value={onDemandEmail}
                            onChange={(e) => setOnDemandEmail(e.target.value)}
                            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="">Select recipient...</option>
                            {subscriptions.map((sub) => (
                                <option key={sub.id} value={sub.email}>{sub.email}</option>
                            ))}
                            <option value="custom">Custom email...</option>
                        </select>
                        {onDemandEmail === 'custom' && (
                            <input
                                type="email"
                                placeholder="Enter email address"
                                value={customEmail}
                                onChange={(e) => setCustomEmail(e.target.value)}
                                className="mt-2 block w-full px-3 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                                required
                            />
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Report Type</label>
                        <select
                            value={onDemandType}
                            onChange={(e) => setOnDemandType(e.target.value as 'short' | 'detailed')}
                            className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                        >
                            <option value="short">Short Summary</option>
                            <option value="detailed">Detailed Summary</option>
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={sendingOnDemand}
                        className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                    >
                        {sendingOnDemand ? <Loader2 className="animate-spin h-5 w-5" /> : <><Send className="h-5 w-5 mr-2" />Send Report</>}
                    </button>
                </form>
            </div>
        </div>
    );
}
