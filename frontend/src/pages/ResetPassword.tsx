import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Loader2, CheckCircle } from 'lucide-react';

export default function ResetPassword() {
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');
    const [isError, setIsError] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);
    const [isValidSession, setIsValidSession] = useState(false);
    const [checkingSession, setCheckingSession] = useState(true);

    useEffect(() => {
        // Check if we have a valid recovery session
        const checkSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();

            // Check URL hash for recovery token (Supabase puts tokens in hash)
            const hashParams = new URLSearchParams(window.location.hash.substring(1));
            const accessToken = hashParams.get('access_token');
            const type = hashParams.get('type');

            if (type === 'recovery' && accessToken) {
                // Set the session from the recovery token
                const { error } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: hashParams.get('refresh_token') || '',
                });

                if (!error) {
                    setIsValidSession(true);
                } else {
                    setMessage('Invalid or expired reset link. Please request a new one.');
                    setIsError(true);
                }
            } else if (session) {
                // Already have a session (came from magic link that auto-signed in)
                setIsValidSession(true);
            } else {
                setMessage('Invalid or expired reset link. Please request a new one.');
                setIsError(true);
            }

            setCheckingSession(false);
        };

        checkSession();
    }, []);

    const handleResetPassword = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            setMessage('Passwords do not match');
            setIsError(true);
            return;
        }

        if (password.length < 6) {
            setMessage('Password must be at least 6 characters');
            setIsError(true);
            return;
        }

        setLoading(true);
        setMessage('');

        try {
            const { error } = await supabase.auth.updateUser({
                password: password,
            });

            if (error) {
                throw error;
            }

            setIsSuccess(true);
            setIsError(false);
            setMessage('Password updated successfully! Redirecting...');

            // Redirect to dashboard after a short delay
            setTimeout(() => {
                navigate('/');
            }, 2000);
        } catch (error: any) {
            setIsError(true);
            setMessage(error.message || 'An error occurred updating your password');
        } finally {
            setLoading(false);
        }
    };

    if (checkingSession) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-gray-50">
                <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
        );
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
            <div className="w-full max-w-md space-y-8">
                <div>
                    <h2 className="mt-6 text-center text-3xl font-bold tracking-tight text-gray-900">
                        {isSuccess ? 'Password Updated' : 'Set your new password'}
                    </h2>
                    <p className="mt-2 text-center text-sm text-gray-600">
                        {isSuccess
                            ? 'Your password has been updated successfully'
                            : 'Enter your new password below'}
                    </p>
                </div>

                {isSuccess ? (
                    <div className="text-center">
                        <CheckCircle className="mx-auto h-16 w-16 text-green-500" />
                        <p className="mt-4 text-sm text-gray-600">{message}</p>
                    </div>
                ) : isValidSession ? (
                    <form className="mt-8 space-y-6" onSubmit={handleResetPassword}>
                        <div className="space-y-4 rounded-md">
                            <div>
                                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                                    New password
                                </label>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    className="relative block w-full rounded-md border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                                    placeholder="New password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </div>
                            <div>
                                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                                    Confirm new password
                                </label>
                                <input
                                    id="confirm-password"
                                    name="confirm-password"
                                    type="password"
                                    autoComplete="new-password"
                                    required
                                    className="relative block w-full rounded-md border-0 py-2 px-3 text-gray-900 ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:z-10 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                                    placeholder="Confirm new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                />
                            </div>
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
                                {loading ? 'Updating...' : 'Update password'}
                            </button>
                        </div>

                        {message && (
                            <div className={`text-center text-sm ${isError ? 'text-red-600' : 'text-green-600'}`}>
                                {message}
                            </div>
                        )}
                    </form>
                ) : (
                    <div className="text-center">
                        <div className="text-red-600 mb-4">{message}</div>
                        <button
                            onClick={() => navigate('/login')}
                            className="text-sm text-blue-600 hover:text-blue-500"
                        >
                            Back to sign in
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
