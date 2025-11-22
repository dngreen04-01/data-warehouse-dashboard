# Xero Integration Setup Guide

This guide explains how to set up the automated Xero data synchronization for the Data Warehouse Dashboard.

## Overview

The Xero integration automatically syncs invoice and sales data from Xero to your Supabase database on a daily basis. It includes:

- **Token encryption** for secure credential storage
- **Automatic token rotation** to maintain continuous access
- **Retry logic** for transient failures
- **Failure notifications** via GitHub Issues
- **Comprehensive logging** for troubleshooting

## Prerequisites

1. **Xero Account** with API access
2. **GitHub Repository** with Actions enabled
3. **Supabase Database** (PostgreSQL)
4. Admin access to configure GitHub Secrets

## Initial Setup

### Step 1: Create a Xero OAuth Application

1. Log in to [Xero Developer Portal](https://developer.xero.com/app/manage)
2. Click **"New app"**
3. Fill in application details:
   - **App name**: Data Warehouse Sync
   - **Company or application URL**: Your organization's URL
   - **Redirect URI**: `https://localhost` (for initial setup)
4. Click **"Create app"**
5. Note down the **Client ID** and **Client Secret**

### Step 2: Generate Initial OAuth Tokens

You need to perform an initial OAuth flow to get a refresh token:

#### Option A: Using Xero OAuth 2.0 Playground

1. Visit the [Xero OAuth 2.0 Playground](https://xero.github.io/xero-oauth2-starter/)
2. Enter your Client ID
3. Select scopes: `accounting.transactions.read`, `accounting.contacts.read`
4. Click **"Get Tokens"**
5. Authorize the application in Xero
6. Copy the **Refresh Token** from the response

#### Option B: Using Manual OAuth Flow

```bash
# 1. Generate authorization URL
https://login.xero.com/identity/connect/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=https://localhost&scope=offline_access%20accounting.transactions%20accounting.contacts&state=123

# 2. Visit URL in browser and authorize
# 3. Copy the 'code' from redirect URL

# 4. Exchange code for tokens
curl -X POST https://identity.xero.com/connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "code=YOUR_AUTH_CODE" \
  -d "redirect_uri=https://localhost"

# 5. Copy the 'refresh_token' from response
```

### Step 3: Get Xero Tenant ID

```bash
# Use the access token from Step 2
curl https://api.xero.com/connections \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"

# Copy the 'tenantId' from the response
```

### Step 4: Configure GitHub Secrets

Navigate to your repository's **Settings** → **Secrets and variables** → **Actions** and add the following secrets:

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `SUPABASE_CONNECTION_STRING` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `XERO_CLIENT_ID` | From Step 1 | `ABC123...` |
| `XERO_CLIENT_SECRET` | From Step 1 | `XYZ789...` |
| `XERO_REFRESH_TOKEN` | From Step 2 | `abc123...` |
| `XERO_TENANT_ID` | From Step 3 | `12345678-...` |
| `XERO_ENCRYPTION_KEY` | Strong random string (32+ chars) | Use: `openssl rand -base64 32` |

**Security Note**: The `XERO_ENCRYPTION_KEY` is used to encrypt tokens in the database. Store it securely and never commit it to version control.

### Step 5: Deploy Database Schema

Run the schema update to create the encrypted token storage table:

```bash
# Connect to your Supabase database
psql $SUPABASE_CONNECTION_STRING -f supabase/schema.sql
```

This creates:
- `dw.xero_tokens` table with encrypted token storage
- Required indexes and constraints
- pgcrypto extension for encryption

### Step 6: Test the Workflow

Manually trigger the workflow to test the setup:

1. Go to **Actions** tab in GitHub
2. Select **"Daily Xero Sync"** workflow
3. Click **"Run workflow"** → **"Run workflow"**
4. Monitor the workflow execution

**Expected output**:
- Workflow completes successfully
- Logs show token refresh and data sync
- Check `dw.etl_run_log` table for run details

## How It Works

### Token Management Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. First Run (using environment XERO_REFRESH_TOKEN)        │
│    ↓                                                        │
│ 2. Refresh access token with Xero API                      │
│    ↓                                                        │
│ 3. Receive new access_token + refresh_token                │
│    ↓                                                        │
│ 4. Encrypt tokens with pgcrypto                            │
│    ↓                                                        │
│ 5. Save encrypted tokens to dw.xero_tokens                 │
│                                                             │
│ Subsequent Runs:                                            │
│ 1. Load encrypted tokens from database                     │
│ 2. Decrypt using XERO_ENCRYPTION_KEY                       │
│ 3. Use if not expired (5 min buffer)                       │
│ 4. Refresh and save new tokens                             │
└─────────────────────────────────────────────────────────────┘
```

### Data Sync Process

1. **Load last sync timestamp** from `dw.sync_state`
2. **Fetch invoices** from Xero API (only modified since last sync)
3. **Extract data** into invoices and line items
4. **Map products** to `dw.dim_product` (auto-create if missing)
5. **Upsert data** to `dw.fct_invoice` and `dw.fct_sales_line`
6. **Update sync state** with latest invoice date
7. **Log results** to `dw.etl_run_log`

### Retry Logic

The workflow automatically retries on failures:
- **Max attempts**: 3
- **Retry wait**: 60 seconds between attempts
- **Timeout**: 10 minutes per attempt

Retries help handle transient issues like network timeouts or temporary API unavailability.

### Failure Notifications

If all retry attempts fail, the workflow:
1. Creates a GitHub Issue with failure details
2. Tags it with `automated-alert`, `xero-sync`, `high-priority`
3. Includes diagnostic information and action items

## Troubleshooting

### Token Refresh Failed (401 Unauthorized)

**Cause**: Refresh token has expired (typically after 60 days of inactivity).

**Solution**:
1. Generate a new refresh token (see Step 2)
2. Update `XERO_REFRESH_TOKEN` secret in GitHub
3. Re-run the workflow

### Encryption Key Mismatch

**Cause**: `XERO_ENCRYPTION_KEY` changed or not set correctly.

**Solution**:
```sql
-- Clear existing encrypted tokens
DELETE FROM dw.xero_tokens;

-- Set correct XERO_ENCRYPTION_KEY secret
-- Re-run workflow to generate new tokens
```

### Database Connection Failure

**Cause**: Invalid `SUPABASE_CONNECTION_STRING` or network issues.

**Solution**:
1. Verify connection string format: `postgresql://user:password@host:port/database`
2. Check Supabase instance is accessible from GitHub Actions
3. Verify database credentials are correct

### No Data Synced

**Cause**: No new invoices since last sync.

**Solution**: This is normal. The workflow logs will show "No new invoices to process".

**Check last sync**:
```sql
SELECT * FROM dw.sync_state WHERE pipeline_name = 'xero_sync';
```

### Checking Sync Status

```sql
-- View recent sync runs
SELECT
    pipeline_name,
    status,
    processed_rows,
    started_at,
    finished_at,
    error_message
FROM dw.etl_run_log
WHERE pipeline_name = 'xero_sync'
ORDER BY started_at DESC
LIMIT 10;

-- Check token status
SELECT
    tenant_id,
    token_expiry,
    updated_at
FROM dw.xero_tokens;
```

## Security Best Practices

1. **Rotate encryption key** periodically (requires re-encrypting tokens)
2. **Use strong, unique passwords** for database access
3. **Restrict database access** to GitHub Actions IP ranges if possible
4. **Monitor sync logs** for suspicious activity
5. **Review GitHub Action logs** regularly
6. **Use least privilege** OAuth scopes (only `accounting.transactions.read`)

## Maintenance

### Monthly Tasks
- Review sync logs for errors
- Check token expiry dates
- Verify data completeness

### Quarterly Tasks
- Rotate `XERO_ENCRYPTION_KEY` (optional but recommended)
- Audit OAuth application permissions
- Review and close automated alert issues

### Annual Tasks
- Renew Xero OAuth application (if required)
- Review and update security practices

## FAQ

### How often does the sync run?
Daily at 01:00 UTC. You can also trigger manually via GitHub Actions.

### What happens if the sync fails?
The workflow retries 3 times. If all attempts fail, a GitHub Issue is created automatically.

### How much data is synced?
Only invoices modified since the last successful sync, making it efficient and fast.

### Can I change the sync schedule?
Yes, edit `.github/workflows/sync_xero.yaml` and modify the `cron` expression.

### Is my data encrypted?
Yes, Xero tokens are encrypted using pgcrypto in the database. Data in transit uses HTTPS.

### How do I rotate the encryption key?

```bash
# 1. Generate new key
NEW_KEY=$(openssl rand -base64 32)

# 2. Clear old tokens
psql $SUPABASE_CONNECTION_STRING -c "DELETE FROM dw.xero_tokens;"

# 3. Update GitHub Secret with NEW_KEY

# 4. Re-run workflow
```

## Support

For issues or questions:
1. Check workflow logs in GitHub Actions
2. Review `dw.etl_run_log` for error details
3. Check automated GitHub Issues for alerts
4. Review this documentation

## References

- [Xero OAuth 2.0 Documentation](https://developer.xero.com/documentation/oauth2/overview)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [PostgreSQL pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html)
