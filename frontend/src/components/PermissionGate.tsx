import { useAuth } from '@/contexts/AuthContext';
import type { ReactNode } from 'react';

interface PermissionGateProps {
    permission?: string;
    role?: string | string[];
    fallback?: ReactNode;
    children: ReactNode;
}

/**
 * A component that conditionally renders its children based on user permissions or roles.
 *
 * @param permission - Required permission string (e.g., "users.invite")
 * @param role - Required role or array of allowed roles (e.g., "super_user" or ["super_user", "administration"])
 * @param fallback - Optional content to render when access is denied (defaults to null)
 * @param children - Content to render when access is granted
 *
 * @example
 * // Permission-based
 * <PermissionGate permission="users.invite">
 *   <InviteButton />
 * </PermissionGate>
 *
 * @example
 * // Role-based
 * <PermissionGate role={["super_user", "administration"]}>
 *   <AdminPanel />
 * </PermissionGate>
 *
 * @example
 * // With fallback
 * <PermissionGate permission="manufacturing.convert" fallback={<AccessDenied />}>
 *   <ManufacturingForm />
 * </PermissionGate>
 */
export function PermissionGate({
    permission,
    role,
    fallback = null,
    children
}: PermissionGateProps) {
    const { hasPermission, role: userRole, isSuperUser } = useAuth();

    // Super user always passes
    if (isSuperUser) {
        return <>{children}</>;
    }

    // Check permission
    if (permission && !hasPermission(permission)) {
        return <>{fallback}</>;
    }

    // Check role
    if (role) {
        const allowedRoles = Array.isArray(role) ? role : [role];
        if (userRole && !allowedRoles.includes(userRole)) {
            return <>{fallback}</>;
        }
        if (!userRole) {
            return <>{fallback}</>;
        }
    }

    return <>{children}</>;
}

/**
 * Hook for programmatic permission checks.
 *
 * @param permission - The permission to check
 * @returns boolean indicating if the user has the permission
 *
 * @example
 * const canInvite = usePermission("users.invite");
 * if (canInvite) {
 *   // show invite button
 * }
 */
export function usePermission(permission: string): boolean {
    const { hasPermission } = useAuth();
    return hasPermission(permission);
}

/**
 * Hook for programmatic role checks.
 *
 * @param allowedRoles - Role or array of roles to check against
 * @returns boolean indicating if the user has one of the allowed roles
 *
 * @example
 * const isAdmin = useRole(["super_user", "administration"]);
 */
export function useRole(allowedRoles: string | string[]): boolean {
    const { role, isSuperUser } = useAuth();

    if (isSuperUser) return true;

    const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    return role !== null && roles.includes(role);
}
