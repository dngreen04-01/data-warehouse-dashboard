import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

export default function Login() {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();

    // Redirect if already authenticated
    useEffect(() => {
        if (!authLoading && user) {
            navigate('/', { replace: true });
        }
    }, [user, authLoading, navigate]);

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(true);
    const [showForgotPassword, setShowForgotPassword] = useState(false);
    const [resetEmailSent, setResetEmailSent] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setMessage('');
        setIsError(true);

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) {
                throw error;
            }
        } catch (error: any) {
            setMessage(error.message || 'An error occurred during login');
        } finally {
            setLoading(false);
        }
    };

    const handleForgotPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) {
            setMessage('Please enter your email address');
            setIsError(true);
            return;
        }

        setLoading(true);
        setMessage('');

        try {
            const { error } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: `${window.location.origin}/reset-password`,
            });

            if (error) {
                throw error;
            }

            setResetEmailSent(true);
            setIsError(false);
            setMessage('Check your email for a password reset link');
        } catch (error: any) {
            setIsError(true);
            setMessage(error.message || 'An error occurred sending reset email');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
            <div className="w-full max-w-md space-y-8">
                <div>
                    <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
                        {showForgotPassword ? 'Reset your password' : 'Sign in to Data Warehouse'}
                    </h2>
                    <p className="mt-2 text-center text-sm text-gray-600">
                        {showForgotPassword
                            ? 'Enter your email to receive a password reset link'
                            : 'Enter your credentials to continue'}
                    </p>
                </div>

                {showForgotPassword ? (
                    <form className="mt-8 space-y-6" onSubmit={handleForgotPassword}>
                        <div className="space-y-4 rounded-md">
                            <div>
                                <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-1">
                                    Email address
                                </label>
                                <input
                                    id="email-address"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    className="relative block w-full rounded-md border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                                    placeholder="Email address"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading || resetEmailSent}
                                className="group relative flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
                            >
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                    {loading && <Loader2 className="h-5 w-5 animate-spin text-blue-300" />}
                                </span>
                                {loading ? 'Sending...' : resetEmailSent ? 'Email sent' : 'Send reset link'}
                            </button>
                        </div>

                        {message && (
                            <div className={`text-center text-sm ${isError ? 'text-red-600' : 'text-green-600'}`}>
                                {message}
                            </div>
                        )}

                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowForgotPassword(false);
                                    setMessage('');
                                    setResetEmailSent(false);
                                }}
                                className="text-sm text-blue-600 hover:text-blue-500"
                            >
                                Back to sign in
                            </button>
                        </div>
                    </form>
                ) : (
                    <form className="mt-8 space-y-6" onSubmit={handleLogin}>
                        <div className="space-y-4 rounded-md">
                            <div>
                                <label htmlFor="email-address" className="block text-sm font-medium text-gray-700 mb-1">
                                    Email address
                                </label>
                                <input
                                    id="email-address"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    className="relative block w-full rounded-md border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                                    placeholder="Email address"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                                    Password
                                </label>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    className="relative block w-full rounded-md border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                                    placeholder="Password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="flex items-center justify-end">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowForgotPassword(true);
                                    setMessage('');
                                }}
                                className="text-sm text-blue-600 hover:text-blue-500"
                            >
                                Forgot your password?
                            </button>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="group relative flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
                            >
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3">
                                    {loading && <Loader2 className="h-5 w-5 animate-spin text-blue-300" />}
                                </span>
                                {loading ? 'Signing in...' : 'Sign in'}
                            </button>
                        </div>

                        {message && (
                            <div className={`text-center text-sm ${isError ? 'text-red-600' : 'text-green-600'}`}>
                                {message}
                            </div>
                        )}
                    </form>
                )}
            </div>
        </div>
    );
}
