#!/usr/bin/env python3
"""
Database Connection Diagnostic Script

Use this script to test database connectivity and diagnose connection issues.
This is particularly useful for troubleshooting GitHub Actions connection failures.

Usage:
    python scripts/test_db_connection.py

Environment Variables Required:
    SUPABASE_CONNECTION_STRING - PostgreSQL connection string

Common Issues:
    1. IPv6 connectivity - GitHub Actions runners may not support IPv6
       Fix: Use the Supabase pooler URL (port 6543) instead of direct connection (port 5432)

    2. SSL/TLS issues - Some environments require specific SSL modes
       Fix: Add ?sslmode=require to connection string

    3. Firewall/Network - Database may not be accessible from runner network
       Fix: Check Supabase network settings
"""

import os
import sys
import socket
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()


def parse_connection_string(conn_str: str) -> dict:
    """Parse connection string into components."""
    if not conn_str:
        return {}

    # Handle postgresql:// URL format
    parsed = urlparse(conn_str)
    return {
        'scheme': parsed.scheme,
        'username': parsed.username,
        'password': '***' if parsed.password else None,
        'hostname': parsed.hostname,
        'port': parsed.port or 5432,
        'database': parsed.path.lstrip('/'),
        'query': parsed.query
    }


def check_dns_resolution(hostname: str) -> dict:
    """Check if hostname can be resolved and what addresses are returned."""
    result = {
        'ipv4': [],
        'ipv6': [],
        'error': None
    }

    try:
        # Get all addresses
        infos = socket.getaddrinfo(hostname, None)
        for info in infos:
            family, _, _, _, addr = info
            if family == socket.AF_INET:
                result['ipv4'].append(addr[0])
            elif family == socket.AF_INET6:
                result['ipv6'].append(addr[0])
    except socket.gaierror as e:
        result['error'] = str(e)

    # Remove duplicates
    result['ipv4'] = list(set(result['ipv4']))
    result['ipv6'] = list(set(result['ipv6']))

    return result


def check_port_connectivity(hostname: str, port: int, timeout: float = 5.0) -> dict:
    """Check if we can connect to the specified host:port."""
    result = {
        'ipv4_reachable': False,
        'ipv6_reachable': False,
        'error': None
    }

    # Try IPv4
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((hostname, port))
        result['ipv4_reachable'] = True
        sock.close()
    except Exception as e:
        result['ipv4_error'] = str(e)

    # Try IPv6
    try:
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((hostname, port))
        result['ipv6_reachable'] = True
        sock.close()
    except Exception as e:
        result['ipv6_error'] = str(e)

    return result


def test_database_connection(conn_str: str) -> dict:
    """Test actual database connection."""
    result = {
        'connected': False,
        'error': None,
        'server_version': None
    }

    try:
        from psycopg import connect
        with connect(conn_str, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT version()")
                result['server_version'] = cur.fetchone()[0]
                result['connected'] = True
    except Exception as e:
        result['error'] = str(e)

    return result


def main():
    print("=" * 60)
    print("Database Connection Diagnostic")
    print("=" * 60)
    print()

    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")

    if not conn_str:
        print("ERROR: SUPABASE_CONNECTION_STRING environment variable not set")
        print()
        print("Set it in .env file or export it:")
        print("  export SUPABASE_CONNECTION_STRING='postgresql://...'")
        sys.exit(1)

    # Parse connection string
    print("1. Parsing Connection String")
    print("-" * 40)
    parsed = parse_connection_string(conn_str)
    for key, value in parsed.items():
        print(f"   {key}: {value}")
    print()

    hostname = parsed.get('hostname')
    port = parsed.get('port', 5432)

    if not hostname:
        print("ERROR: Could not extract hostname from connection string")
        sys.exit(1)

    # Check DNS resolution
    print("2. DNS Resolution")
    print("-" * 40)
    dns = check_dns_resolution(hostname)
    if dns['error']:
        print(f"   ERROR: {dns['error']}")
    else:
        print(f"   IPv4 addresses: {dns['ipv4'] or 'None'}")
        print(f"   IPv6 addresses: {dns['ipv6'] or 'None'}")

        if dns['ipv6'] and not dns['ipv4']:
            print()
            print("   WARNING: Only IPv6 addresses available!")
            print("   GitHub Actions runners may not support IPv6.")
            print("   Consider using Supabase pooler URL (port 6543) instead.")
    print()

    # Check port connectivity
    print(f"3. Port Connectivity ({hostname}:{port})")
    print("-" * 40)
    connectivity = check_port_connectivity(hostname, port)
    print(f"   IPv4 reachable: {connectivity['ipv4_reachable']}")
    if not connectivity['ipv4_reachable'] and 'ipv4_error' in connectivity:
        print(f"   IPv4 error: {connectivity['ipv4_error']}")
    print(f"   IPv6 reachable: {connectivity['ipv6_reachable']}")
    if not connectivity['ipv6_reachable'] and 'ipv6_error' in connectivity:
        print(f"   IPv6 error: {connectivity['ipv6_error']}")
    print()

    # Test actual database connection
    print("4. Database Connection Test")
    print("-" * 40)
    db_test = test_database_connection(conn_str)
    if db_test['connected']:
        print(f"   Connected: YES")
        print(f"   Server: {db_test['server_version'][:50]}...")
    else:
        print(f"   Connected: NO")
        print(f"   Error: {db_test['error']}")
    print()

    # Summary and recommendations
    print("=" * 60)
    print("Summary & Recommendations")
    print("=" * 60)

    if db_test['connected']:
        print("Connection successful! No issues detected.")
    else:
        print("Connection FAILED. Possible fixes:")
        print()

        if dns['ipv6'] and not dns['ipv4']:
            print("1. IPv6-only hostname detected")
            print("   -> Use Supabase connection pooler URL instead")
            print("   -> In Supabase Dashboard: Settings > Database > Connection Pooling")
            print("   -> Use the pooler URL with port 6543")
            print()

        if port == 5432:
            print("2. Using direct connection (port 5432)")
            print("   -> Try the pooler connection (port 6543) for better compatibility")
            print()

        if 'SSL' in str(db_test.get('error', '')).upper():
            print("3. SSL/TLS issue detected")
            print("   -> Add ?sslmode=require to connection string")
            print()

        print("For GitHub Actions specifically:")
        print("- Update the SUPABASE_CONNECTION_STRING secret")
        print("- Use the Connection Pooling URL from Supabase Dashboard")
        print("- Format: postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres")

    print()
    return 0 if db_test['connected'] else 1


if __name__ == "__main__":
    sys.exit(main())
