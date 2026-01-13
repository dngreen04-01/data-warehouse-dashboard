import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2, UserPlus, Users, Shield, Trash2, Mail, Clock, CheckCircle2 } from 'lucide-react';
import clsx from 'clsx';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001';

interface User {
    user_id: string;
    email: string;
    role_id: string | null;
    role_name: string | null;
    last_sign_in_at: string | null;
    created_at: string;
}

interface Invitation {
    id: string;
    email: string;
    role_id: string;
    role_name: string;
    invited_at: string;
    expires_at: string;
    invited_by_email: string;
}

interface Role {
    role_id: string;
    role_name: string;
    description: string;
}

export default function UserManagement() {
    const { session, isSuperUser } = useAuth();
    const [users, setUsers] = useState<User[]>([]);
    const [invitations, setInvitations] = useState<Invitation[]>([]);
    const [roles, setRoles] = useState<Role[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Invite form state
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState('sales');
    const [inviting, setInviting] = useState(false);

    const authHeaders = {
        'Authorization': `Bearer ${session?.access_token}`,
        'Content-Type': 'application/json'
    };

    useEffect(() => {
        fetchData();
    }, [session]);

    async function fetchData() {
        if (!session?.access_token) return;

        setLoading(true);
        setError(null);

        try {
            const [usersRes, rolesRes] = await Promise.all([
                fetch(`${API_BASE}/api/users`, { headers: authHeaders }),
                fetch(`${API_BASE}/api/roles`, { headers: authHeaders })
            ]);

            if (usersRes.ok) {
                const data = await usersRes.json();
                setUsers(data.users || []);
            } else if (usersRes.status === 403) {
                setError('You do not have permission to view users.');
            } else {
                throw new Error('Failed to fetch users');
            }

            if (rolesRes.ok) {
                const data = await rolesRes.json();
                setRoles(data.roles || []);
                // Set default invite role if not already set
                if (data.roles?.length > 0 && !inviteRole) {
                    const defaultRole = data.roles.find((r: Role) => r.role_id !== 'super_user');
                    if (defaultRole) setInviteRole(defaultRole.role_id);
                }
            }

            // Fetch invitations only for super users
            if (isSuperUser) {
                const invitationsRes = await fetch(`${API_BASE}/api/users/invitations`, {
                    headers: authHeaders
                });
                if (invitationsRes.ok) {
                    const data = await invitationsRes.json();
                    setInvitations(data.invitations || []);
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load data');
        } finally {
            setLoading(false);
        }
    }

    async function handleInvite(e: React.FormEvent) {
        e.preventDefault();
        if (!inviteEmail || !inviteRole) return;

        setInviting(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch(`${API_BASE}/api/users/invite`, {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    email: inviteEmail,
                    role_id: inviteRole
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to send invitation');
            }

            setSuccess(`Invitation sent to ${inviteEmail}`);
            setInviteEmail('');
            fetchData();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to send invitation');
        } finally {
            setInviting(false);
        }
    }

    async function handleRevokeInvitation(id: string) {
        if (!confirm('Are you sure you want to revoke this invitation?')) return;

        try {
            const response = await fetch(`${API_BASE}/api/users/invitations/${id}`, {
                method: 'DELETE',
                headers: authHeaders
            });

            if (response.ok) {
                setInvitations(inv => inv.filter(i => i.id !== id));
                setSuccess('Invitation revoked');
            } else {
                throw new Error('Failed to revoke invitation');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to revoke invitation');
        }
    }

    function formatDate(dateString: string | null): string {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleDateString('en-NZ', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function getRoleBadgeColor(roleId: string | null): string {
        switch (roleId) {
            case 'super_user':
                return 'bg-purple-100 text-purple-800';
            case 'administration':
                return 'bg-blue-100 text-blue-800';
            case 'sales':
                return 'bg-green-100 text-green-800';
            default:
                return 'bg-gray-100 text-gray-800';
        }
    }

    if (!isSuperUser) {
        return (
            <div className="text-center py-12">
                <Shield className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900">Access Denied</h2>
                <p className="text-gray-500 mt-2">Only super users can manage users.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
                    <p className="mt-1 text-sm text-gray-500">
                        Invite users and manage their access roles.
                    </p>
                </div>
            </div>

            {/* Alerts */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-md p-4">
                    <p className="text-sm text-red-600">{error}</p>
                </div>
            )}
            {success && (
                <div className="bg-green-50 border border-green-200 rounded-md p-4 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <p className="text-sm text-green-600">{success}</p>
                </div>
            )}

            {/* Invite User Form */}
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
                    <UserPlus className="h-5 w-5" />
                    Invite New User
                </h3>
                <form onSubmit={handleInvite} className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Email Address
                        </label>
                        <input
                            type="email"
                            required
                            value={inviteEmail}
                            onChange={(e) => setInviteEmail(e.target.value)}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                            placeholder="user@example.com"
                        />
                    </div>
                    <div className="w-full sm:w-48">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Role
                        </label>
                        <select
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value)}
                            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                        >
                            {roles.filter(r => r.role_id !== 'super_user').map(role => (
                                <option key={role.role_id} value={role.role_id}>
                                    {role.role_name}
                                </option>
                            ))}
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={inviting || !inviteEmail}
                        className={clsx(
                            "inline-flex items-center justify-center gap-2 px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white",
                            inviting || !inviteEmail
                                ? "bg-blue-400 cursor-not-allowed"
                                : "bg-blue-600 hover:bg-blue-700"
                        )}
                    >
                        {inviting ? (
                            <>
                                <Loader2 className="animate-spin h-4 w-4" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Mail className="h-4 w-4" />
                                Send Invitation
                            </>
                        )}
                    </button>
                </form>
            </div>

            {/* Pending Invitations */}
            {invitations.length > 0 && (
                <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 border-b border-gray-200 bg-amber-50">
                        <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                            <Clock className="h-5 w-5 text-amber-600" />
                            Pending Invitations ({invitations.length})
                        </h3>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invited By</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</th>
                                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {invitations.map((inv) => (
                                    <tr key={inv.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {inv.email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <span className={clsx(
                                                "px-2 py-1 rounded-full text-xs font-medium",
                                                getRoleBadgeColor(inv.role_id)
                                            )}>
                                                {inv.role_name}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {inv.invited_by_email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {formatDate(inv.expires_at)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                                            <button
                                                onClick={() => handleRevokeInvitation(inv.id)}
                                                className="text-red-600 hover:text-red-900 inline-flex items-center gap-1"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                                Revoke
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Users List */}
            <div className="bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-200">
                    <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                        <Users className="h-5 w-5" />
                        All Users ({users.length})
                    </h3>
                </div>
                {loading ? (
                    <div className="p-12 flex justify-center">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Sign In</th>
                                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                                {users.map((user) => (
                                    <tr key={user.user_id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                                            {user.email}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            <span className={clsx(
                                                "px-2 py-1 rounded-full text-xs font-medium",
                                                getRoleBadgeColor(user.role_id)
                                            )}>
                                                {user.role_name || 'No Role'}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {formatDate(user.last_sign_in_at)}
                                        </td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                            {formatDate(user.created_at)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
