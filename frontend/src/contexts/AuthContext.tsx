import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { jwtDecode } from 'jwt-decode';

interface DecodedToken {
    sub: string;
    email?: string;
    user_role?: string;
    permissions?: string[];
    exp: number;
}

interface AuthContextType {
    user: User | null;
    session: Session | null;
    loading: boolean;
    role: string | null;
    permissions: string[];
    isSuperUser: boolean;
    isAdmin: boolean;
    hasPermission: (permission: string) => boolean;
    signOut: () => Promise<void>;
    refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [role, setRole] = useState<string | null>(null);
    const [permissions, setPermissions] = useState<string[]>([]);

    const parseToken = useCallback((accessToken: string | undefined) => {
        if (!accessToken) {
            setRole(null);
            setPermissions([]);
            return;
        }

        try {
            const decoded = jwtDecode<DecodedToken>(accessToken);
            setRole(decoded.user_role || null);
            setPermissions(decoded.permissions || []);
        } catch (error) {
            console.error('Error decoding token:', error);
            setRole(null);
            setPermissions([]);
        }
    }, []);

    const refreshSession = useCallback(async () => {
        const { data: { session } } = await supabase.auth.refreshSession();
        if (session) {
            setSession(session);
            setUser(session.user);
            parseToken(session.access_token);
        }
    }, [parseToken]);

    useEffect(() => {
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            parseToken(session?.access_token);
            setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            parseToken(session?.access_token);
            setLoading(false);
        });

        return () => subscription.unsubscribe();
    }, [parseToken]);

    const signOut = async () => {
        await supabase.auth.signOut();
        setRole(null);
        setPermissions([]);
    };

    const isSuperUser = role === 'super_user';
    const isAdmin = role === 'super_user' || role === 'administration';

    const hasPermission = useCallback((permission: string): boolean => {
        if (isSuperUser) return true;  // Super user has all permissions
        return permissions.includes(permission);
    }, [isSuperUser, permissions]);

    return (
        <AuthContext.Provider value={{
            user,
            session,
            loading,
            role,
            permissions,
            isSuperUser,
            isAdmin,
            hasPermission,
            signOut,
            refreshSession
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
