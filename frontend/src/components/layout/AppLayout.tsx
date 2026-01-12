import { type ReactNode, useState } from 'react';
import {
    LayoutDashboard,
    Menu,
    X,
    LogOut,
    User as UserIcon,
    Users,
    FileText,
    Package,
    UserCircle,
    ChevronRight,
    BarChart3,
    AlertTriangle,
    GitMerge,
    MessageSquare,
    Mail
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import clsx from 'clsx';

const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard, description: 'Sales overview & analytics' },
    { name: 'Customers', href: '/customers', icon: UserCircle, description: 'Manage customer records' },
    { name: 'Products', href: '/products', icon: Package, description: 'Product catalog' },
    { name: 'Data Maintenance', href: '/maintenance', icon: GitMerge, description: 'Match & consolidate data' },
    { name: 'Statements', href: '/statements', icon: FileText, description: 'Outstanding invoices' },
    { name: 'Clusters', href: '/clusters', icon: Users, description: 'Customer segments' },
    { name: 'CRM', href: '/crm', icon: MessageSquare, description: 'Email insights' },
    { name: 'Email Reports', href: '/email-subscriptions', icon: Mail, description: 'Manage weekly reports' },
];

const debugNavigation = [
    { name: 'Invoice Debug', href: '/debug/invoices', icon: AlertTriangle, description: 'Diagnose revenue issues' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const location = useLocation();
    const { signOut, user } = useAuth();

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Mobile header */}
            <div className="lg:hidden fixed top-0 left-0 right-0 bg-white border-b border-gray-200 shadow-sm z-50">
                <div className="flex items-center justify-between px-4 h-16">
                    <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 shadow-md">
                            <BarChart3 className="h-5 w-5 text-white" />
                        </div>
                        <span className="font-bold text-lg text-gray-900">Klipon</span>
                    </div>
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                    >
                        {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
                    </button>
                </div>
            </div>

            {/* Mobile overlay */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-gray-900/50 z-30 lg:hidden"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={clsx(
                "fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-white border-r border-gray-200 transition-transform duration-300 ease-in-out lg:translate-x-0",
                sidebarOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                {/* Logo */}
                <div className="flex h-16 items-center gap-3 px-6 border-b border-gray-100">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 shadow-lg shadow-blue-500/25">
                        <BarChart3 className="h-6 w-6 text-white" />
                    </div>
                    <div>
                        <h1 className="font-bold text-gray-900 text-lg">Klipon</h1>
                        <p className="text-xs text-gray-500">Data Warehouse</p>
                    </div>
                </div>

                {/* Navigation */}
                <nav className="flex-1 overflow-y-auto px-4 py-6">
                    <div className="space-y-1">
                        {navigation.map((item) => {
                            const isActive = location.pathname === item.href;
                            return (
                                <Link
                                    key={item.name}
                                    to={item.href}
                                    onClick={() => setSidebarOpen(false)}
                                    className={clsx(
                                        'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                                        isActive
                                            ? 'bg-blue-50 text-blue-700 shadow-sm'
                                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                    )}
                                >
                                    <div className={clsx(
                                        'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                                        isActive
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700'
                                    )}>
                                        <item.icon className="h-5 w-5" />
                                    </div>
                                    <div className="flex-1">
                                        <span className="block">{item.name}</span>
                                        <span className={clsx(
                                            'text-xs',
                                            isActive ? 'text-blue-600' : 'text-gray-400'
                                        )}>
                                            {item.description}
                                        </span>
                                    </div>
                                    {isActive && (
                                        <ChevronRight className="h-4 w-4 text-blue-500" />
                                    )}
                                </Link>
                            );
                        })}
                    </div>

                    {/* Debug Section */}
                    <div className="mt-6 pt-6 border-t border-gray-200">
                        <p className="px-3 mb-2 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                            Debug Tools
                        </p>
                        <div className="space-y-1">
                            {debugNavigation.map((item) => {
                                const isActive = location.pathname === item.href;
                                return (
                                    <Link
                                        key={item.name}
                                        to={item.href}
                                        onClick={() => setSidebarOpen(false)}
                                        className={clsx(
                                            'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                                            isActive
                                                ? 'bg-amber-50 text-amber-700 shadow-sm'
                                                : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                        )}
                                    >
                                        <div className={clsx(
                                            'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                                            isActive
                                                ? 'bg-amber-100 text-amber-700'
                                                : 'bg-gray-100 text-gray-500 group-hover:bg-amber-50 group-hover:text-amber-600'
                                        )}>
                                            <item.icon className="h-5 w-5" />
                                        </div>
                                        <div className="flex-1">
                                            <span className="block">{item.name}</span>
                                            <span className={clsx(
                                                'text-xs',
                                                isActive ? 'text-amber-600' : 'text-gray-400'
                                            )}>
                                                {item.description}
                                            </span>
                                        </div>
                                        {isActive && (
                                            <ChevronRight className="h-4 w-4 text-amber-500" />
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </nav>

                {/* User section */}
                <div className="border-t border-gray-100 p-4">
                    <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-gray-200 to-gray-300">
                            <UserIcon className="h-5 w-5 text-gray-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                                {user?.email?.split('@')[0] || 'User'}
                            </p>
                            <p className="text-xs text-gray-500 truncate">
                                {user?.email || 'user@example.com'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={() => signOut()}
                        className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                        <LogOut className="h-4 w-4" />
                        Sign out
                    </button>
                </div>
            </aside>

            {/* Main content */}
            <main className="lg:pl-72 pt-16 lg:pt-0 min-h-screen">
                <div className="px-4 py-8 sm:px-6 lg:px-8 max-w-7xl mx-auto">
                    {children}
                </div>
            </main>
        </div>
    );
}
