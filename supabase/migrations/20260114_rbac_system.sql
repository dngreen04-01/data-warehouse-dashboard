-- =============================================================================
-- RBAC System Migration: User Roles, Permissions, and Invitations
-- =============================================================================
-- This migration creates:
-- 1. Role and permission tables in dw schema
-- 2. User-role mapping table
-- 3. User invitations table
-- 4. Custom Access Token Hook for JWT claims injection
-- 5. Helper functions for permission checking and user management
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: dw.app_roles - Available roles in the system
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.app_roles (
    role_id text PRIMARY KEY,
    role_name text NOT NULL,
    description text,
    is_system_role boolean DEFAULT false,
    created_at timestamptz DEFAULT timezone('utc', now())
);

COMMENT ON TABLE dw.app_roles IS 'Defines available roles in the application';

-- Seed initial roles
INSERT INTO dw.app_roles (role_id, role_name, description, is_system_role) VALUES
    ('super_user', 'Super User', 'Full access including user management and invitations', true),
    ('administration', 'Administration', 'Full access to all features except user management', true),
    ('sales', 'Sales', 'Sales-focused access (currently full access, can be restricted)', true)
ON CONFLICT (role_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Table: dw.user_roles - Links users to their roles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.user_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id text NOT NULL REFERENCES dw.app_roles(role_id),
    assigned_by uuid REFERENCES auth.users(id),
    assigned_at timestamptz DEFAULT timezone('utc', now()),
    UNIQUE(user_id)  -- One role per user
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON dw.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON dw.user_roles(role_id);

COMMENT ON TABLE dw.user_roles IS 'Maps Supabase auth users to application roles';

-- -----------------------------------------------------------------------------
-- Table: dw.user_invitations - Tracks pending user invitations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.user_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    role_id text NOT NULL REFERENCES dw.app_roles(role_id),
    invited_by uuid NOT NULL REFERENCES auth.users(id),
    invited_at timestamptz DEFAULT timezone('utc', now()),
    expires_at timestamptz DEFAULT timezone('utc', now()) + interval '7 days',
    accepted_at timestamptz,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

-- Partial unique index: only one pending invitation per email
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_invitations_pending_email
    ON dw.user_invitations(email) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_user_invitations_email ON dw.user_invitations(email);
CREATE INDEX IF NOT EXISTS idx_user_invitations_status ON dw.user_invitations(status);

COMMENT ON TABLE dw.user_invitations IS 'Tracks pending and historical user invitations';

-- -----------------------------------------------------------------------------
-- Table: dw.permissions - Granular permissions for future-proofing
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.permissions (
    permission_id text PRIMARY KEY,
    permission_name text NOT NULL,
    description text,
    category text,
    created_at timestamptz DEFAULT timezone('utc', now())
);

COMMENT ON TABLE dw.permissions IS 'Defines granular permissions for feature-level access control';

-- Seed initial permissions
INSERT INTO dw.permissions (permission_id, permission_name, category, description) VALUES
    ('users.invite', 'Invite Users', 'users', 'Can invite new users to the application'),
    ('users.manage', 'Manage Users', 'users', 'Can view and manage user roles'),
    ('dashboard.view', 'View Dashboard', 'dashboard', 'Can view the main dashboard'),
    ('reports.view', 'View Reports', 'reports', 'Can view reports'),
    ('reports.send', 'Send Reports', 'reports', 'Can trigger report sending'),
    ('manufacturing.view', 'View Manufacturing', 'manufacturing', 'Can view manufacturing data'),
    ('manufacturing.convert', 'Manufacturing Conversion', 'manufacturing', 'Can perform production conversions'),
    ('statements.view', 'View Statements', 'statements', 'Can view merchant statements'),
    ('statements.download', 'Download Statements', 'statements', 'Can download statement PDFs'),
    ('customers.view', 'View Customers', 'customers', 'Can view customer data'),
    ('customers.edit', 'Edit Customers', 'customers', 'Can edit customer information'),
    ('products.view', 'View Products', 'products', 'Can view product catalog'),
    ('products.edit', 'Edit Products', 'products', 'Can edit product information'),
    ('crm.view', 'View CRM', 'crm', 'Can view CRM data'),
    ('crm.edit', 'Edit CRM', 'crm', 'Can edit CRM data'),
    ('maintenance.access', 'Data Maintenance', 'maintenance', 'Can access data maintenance tools')
ON CONFLICT (permission_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Table: dw.role_permissions - Maps roles to permissions
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dw.role_permissions (
    role_id text NOT NULL REFERENCES dw.app_roles(role_id) ON DELETE CASCADE,
    permission_id text NOT NULL REFERENCES dw.permissions(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

COMMENT ON TABLE dw.role_permissions IS 'Maps roles to their granted permissions';

-- Grant all permissions to super_user
INSERT INTO dw.role_permissions (role_id, permission_id)
SELECT 'super_user', permission_id FROM dw.permissions
ON CONFLICT DO NOTHING;

-- Grant all permissions except user management to administration
INSERT INTO dw.role_permissions (role_id, permission_id)
SELECT 'administration', permission_id FROM dw.permissions
WHERE permission_id NOT IN ('users.invite', 'users.manage')
ON CONFLICT DO NOTHING;

-- Grant all permissions except user management to sales (can restrict later)
INSERT INTO dw.role_permissions (role_id, permission_id)
SELECT 'sales', permission_id FROM dw.permissions
WHERE permission_id NOT IN ('users.invite', 'users.manage')
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- Function: public.custom_access_token_hook
-- Injects user_role and permissions into JWT claims
-- Must be registered in Supabase Dashboard > Authentication > Hooks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    claims jsonb;
    user_role text;
    user_permissions text[];
BEGIN
    -- Get the user's role
    SELECT ur.role_id INTO user_role
    FROM dw.user_roles ur
    WHERE ur.user_id = (event->>'user_id')::uuid;

    claims := event->'claims';

    IF user_role IS NOT NULL THEN
        -- Set the role claim
        claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));

        -- Get permissions for this role
        SELECT array_agg(rp.permission_id) INTO user_permissions
        FROM dw.role_permissions rp
        WHERE rp.role_id = user_role;

        IF user_permissions IS NOT NULL THEN
            claims := jsonb_set(claims, '{permissions}', to_jsonb(user_permissions));
        ELSE
            claims := jsonb_set(claims, '{permissions}', '[]'::jsonb);
        END IF;
    ELSE
        claims := jsonb_set(claims, '{user_role}', 'null'::jsonb);
        claims := jsonb_set(claims, '{permissions}', '[]'::jsonb);
    END IF;

    -- Update the claims object in the original event
    event := jsonb_set(event, '{claims}', claims);

    RETURN event;
END;
$$;

-- Grant necessary permissions for the auth hook
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;

-- Auth admin needs read access to user_roles and role_permissions
GRANT USAGE ON SCHEMA dw TO supabase_auth_admin;
GRANT SELECT ON dw.user_roles TO supabase_auth_admin;
GRANT SELECT ON dw.role_permissions TO supabase_auth_admin;
GRANT SELECT ON dw.app_roles TO supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- Function: public.has_permission
-- Check if current user has a specific permission
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    user_role text;
BEGIN
    -- Get role from JWT claims
    user_role := (SELECT auth.jwt() ->> 'user_role');

    -- Super user has all permissions
    IF user_role = 'super_user' THEN
        RETURN true;
    END IF;

    IF user_role IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM dw.role_permissions rp
        WHERE rp.role_id = user_role
        AND rp.permission_id = required_permission
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- Function: public.get_current_user_role
-- Get current user's role and permissions
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS TABLE (
    role_id text,
    role_name text,
    permissions text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.role_id,
        r.role_name,
        array_agg(rp.permission_id) as permissions
    FROM dw.app_roles r
    LEFT JOIN dw.role_permissions rp ON r.role_id = rp.role_id
    WHERE r.role_id = (SELECT auth.jwt() ->> 'user_role')
    GROUP BY r.role_id, r.role_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;

-- -----------------------------------------------------------------------------
-- Function: public.invite_user
-- Create a user invitation (super_user only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invite_user(
    p_email text,
    p_role_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invitation_id uuid;
    v_current_user_role text;
BEGIN
    -- Check if current user is super_user
    v_current_user_role := (SELECT auth.jwt() ->> 'user_role');

    IF v_current_user_role != 'super_user' THEN
        RAISE EXCEPTION 'Only super_user can invite users';
    END IF;

    -- Cannot invite as super_user
    IF p_role_id = 'super_user' THEN
        RAISE EXCEPTION 'Cannot invite users as super_user';
    END IF;

    -- Check if role exists
    IF NOT EXISTS (SELECT 1 FROM dw.app_roles WHERE role_id = p_role_id) THEN
        RAISE EXCEPTION 'Invalid role: %', p_role_id;
    END IF;

    -- Check if user already exists
    IF EXISTS (SELECT 1 FROM auth.users WHERE email = p_email) THEN
        RAISE EXCEPTION 'User with this email already exists';
    END IF;

    -- Check for existing pending invitation
    IF EXISTS (SELECT 1 FROM dw.user_invitations WHERE email = p_email AND status = 'pending') THEN
        RAISE EXCEPTION 'Pending invitation already exists for this email';
    END IF;

    -- Create invitation record
    INSERT INTO dw.user_invitations (email, role_id, invited_by)
    VALUES (p_email, p_role_id, auth.uid())
    RETURNING id INTO v_invitation_id;

    RETURN v_invitation_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.invite_user(text, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- Function: public.list_users_with_roles
-- List all users with their roles (super_user and administration only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_users_with_roles()
RETURNS TABLE (
    user_id uuid,
    email text,
    role_id text,
    role_name text,
    last_sign_in_at timestamptz,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_current_role text;
BEGIN
    v_current_role := (SELECT auth.jwt() ->> 'user_role');

    -- Only super_user and administration can list users
    IF v_current_role NOT IN ('super_user', 'administration') THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    RETURN QUERY
    SELECT
        u.id as user_id,
        u.email::text,
        ur.role_id,
        r.role_name,
        u.last_sign_in_at,
        u.created_at
    FROM auth.users u
    LEFT JOIN dw.user_roles ur ON u.id = ur.user_id
    LEFT JOIN dw.app_roles r ON ur.role_id = r.role_id
    ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_users_with_roles() TO authenticated;

-- -----------------------------------------------------------------------------
-- Function: public.list_pending_invitations
-- List pending invitations (super_user only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_pending_invitations()
RETURNS TABLE (
    id uuid,
    email text,
    role_id text,
    role_name text,
    invited_at timestamptz,
    expires_at timestamptz,
    invited_by_email text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.jwt() ->> 'user_role') != 'super_user' THEN
        RAISE EXCEPTION 'Only super_user can view invitations';
    END IF;

    RETURN QUERY
    SELECT
        i.id,
        i.email,
        i.role_id,
        r.role_name,
        i.invited_at,
        i.expires_at,
        u.email::text as invited_by_email
    FROM dw.user_invitations i
    JOIN dw.app_roles r ON i.role_id = r.role_id
    JOIN auth.users u ON i.invited_by = u.id
    WHERE i.status = 'pending'
    AND i.expires_at > now()
    ORDER BY i.invited_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_pending_invitations() TO authenticated;

-- -----------------------------------------------------------------------------
-- Function: public.revoke_invitation
-- Revoke a pending invitation (super_user only)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revoke_invitation(p_invitation_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT auth.jwt() ->> 'user_role') != 'super_user' THEN
        RAISE EXCEPTION 'Only super_user can revoke invitations';
    END IF;

    UPDATE dw.user_invitations
    SET status = 'revoked'
    WHERE id = p_invitation_id AND status = 'pending';

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_invitation(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Function: public.list_roles
-- List available roles for invitation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_roles()
RETURNS TABLE (
    role_id text,
    role_name text,
    description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.role_id,
        r.role_name,
        r.description
    FROM dw.app_roles r
    ORDER BY
        CASE r.role_id
            WHEN 'super_user' THEN 1
            WHEN 'administration' THEN 2
            WHEN 'sales' THEN 3
            ELSE 4
        END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_roles() TO authenticated;

-- -----------------------------------------------------------------------------
-- Trigger Function: handle_new_user_role
-- Auto-assigns role when a new user signs up
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_invitation record;
BEGIN
    -- Check for pending invitation
    SELECT * INTO v_invitation
    FROM dw.user_invitations
    WHERE email = NEW.email
    AND status = 'pending'
    AND expires_at > now()
    ORDER BY invited_at DESC
    LIMIT 1;

    IF v_invitation.id IS NOT NULL THEN
        -- Assign the invited role
        INSERT INTO dw.user_roles (user_id, role_id, assigned_by)
        VALUES (NEW.id, v_invitation.role_id, v_invitation.invited_by);

        -- Mark invitation as accepted
        UPDATE dw.user_invitations
        SET status = 'accepted', accepted_at = now()
        WHERE id = v_invitation.id;
    ELSIF NEW.email = 'damien.green@brands.co.nz' THEN
        -- Auto-assign super_user to the designated email
        INSERT INTO dw.user_roles (user_id, role_id)
        VALUES (NEW.id, 'super_user')
        ON CONFLICT (user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$;

-- Create trigger on auth.users (if not exists)
DROP TRIGGER IF EXISTS on_auth_user_created_assign_role ON auth.users;
CREATE TRIGGER on_auth_user_created_assign_role
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user_role();

-- -----------------------------------------------------------------------------
-- Assign super_user to existing damien.green@brands.co.nz user (if exists)
-- -----------------------------------------------------------------------------
INSERT INTO dw.user_roles (user_id, role_id)
SELECT id, 'super_user'
FROM auth.users
WHERE email = 'damien.green@brands.co.nz'
ON CONFLICT (user_id) DO UPDATE SET role_id = 'super_user';

-- -----------------------------------------------------------------------------
-- Grant authenticated users access to new tables for RPC functions
-- -----------------------------------------------------------------------------
GRANT SELECT ON dw.app_roles TO authenticated;
GRANT SELECT ON dw.permissions TO authenticated;
-- Note: user_roles, user_invitations, role_permissions accessed via SECURITY DEFINER functions only
