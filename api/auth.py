"""
JWT verification and authorization middleware for FastAPI.
Verifies Supabase JWT tokens and extracts user claims including role and permissions.
"""
import os
from pathlib import Path
from typing import Optional, List
import jwt
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from dotenv import load_dotenv

# Load .env file before accessing environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path, override=True)


class UserClaims(BaseModel):
    """Parsed user claims from JWT."""
    sub: str  # user_id
    email: Optional[str] = None
    user_role: Optional[str] = None
    permissions: List[str] = []


# Supabase JWT settings - loaded from environment
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

# HTTPBearer for Authorization header parsing
security = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> Optional[UserClaims]:
    """
    Verify JWT and extract user claims.
    Returns None if no token provided (for optional auth endpoints).
    Raises HTTPException if token is invalid.
    """
    if credentials is None:
        return None

    token = credentials.credentials

    if not SUPABASE_JWT_SECRET:
        raise HTTPException(
            status_code=500,
            detail="Server configuration error: JWT secret not configured"
        )

    try:
        # Decode JWT using Supabase JWT secret
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )

        claims = UserClaims(
            sub=payload.get("sub"),
            email=payload.get("email"),
            user_role=payload.get("user_role"),
            permissions=payload.get("permissions", [])
        )
        print(f"[DEBUG] JWT decoded - email: {claims.email}, role: {claims.user_role}, permissions: {claims.permissions}")
        return claims
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        print(f"[DEBUG] JWT decode error: {str(e)}")
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")


async def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
) -> UserClaims:
    """
    Dependency that requires authentication.
    Use this for endpoints that must have a logged-in user.
    """
    user = await get_current_user(credentials)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def require_permission(permission: str):
    """
    Dependency factory that requires a specific permission.
    Super user bypasses all permission checks.

    Usage:
        @app.get("/api/protected")
        async def protected_endpoint(user: UserClaims = Depends(require_permission("some.permission"))):
            ...
    """
    async def permission_checker(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
    ) -> UserClaims:
        user = await get_current_user(credentials)
        if user is None:
            raise HTTPException(status_code=401, detail="Authentication required")

        # Super user has all permissions
        if user.user_role == 'super_user':
            return user

        if permission not in user.permissions:
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied. Required: {permission}"
            )
        return user

    return permission_checker


def require_role(allowed_roles: List[str]):
    """
    Dependency factory that requires one of the specified roles.

    Usage:
        @app.get("/api/admin-only")
        async def admin_endpoint(user: UserClaims = Depends(require_role(["super_user", "administration"]))):
            ...
    """
    async def role_checker(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
    ) -> UserClaims:
        user = await get_current_user(credentials)
        if user is None:
            raise HTTPException(status_code=401, detail="Authentication required")

        if user.user_role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Role not authorized. Allowed: {allowed_roles}"
            )
        return user

    return role_checker


def require_super_user():
    """
    Dependency that requires super_user role.
    Convenience wrapper for require_role(["super_user"]).
    """
    return require_role(["super_user"])
