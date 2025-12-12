"""
Sync Budgets from Xero to Data Warehouse
"""

import logging
import os
import requests
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from psycopg import connect
from src.ingestion.sync_xero import XeroClient, XeroCredentials

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

API_BASE = "https://api.xero.com/api.xro/2.0"

def fetch_budgets(client: XeroClient) -> list:
    """Fetch all budgets from Xero."""
    headers = client._auth_header()
    # Budgets endpoint: https://api.xero.com/api.xro/2.0/Budgets
    url = f"{API_BASE}/Budgets"
    
    logger.info("Fetching budgets summary...")
    resp = requests.get(url, headers=headers)
    resp.raise_for_status()
    
    budgets = resp.json().get("Budgets", [])
    logger.info(f"Found {len(budgets)} budgets: {[b.get('Description') for b in budgets]}")

    # Sync ALL budgets - no filtering
    # Available budgets will include: overall budget, Budget F26 Updated, F26, TBO NZ budget test, trial 2016, etc.

    all_budget_data = []
    
    for b in budgets:
        budget_id = b.get("BudgetID")
        description = b.get("Description")
        logger.info(f"Fetching details for budget: {description} ({budget_id})")
        
        detail_resp = requests.get(f"{url}/{budget_id}", headers=headers)
        if detail_resp.status_code == 200:
            detail_data = detail_resp.json().get("Budgets", [])[0]
            # Debug structure
            logger.info(f"Budget Keys: {detail_data.keys()}")
            lines = detail_data.get("BudgetLines", [])
            logger.info(f"Budget Lines Count: {len(lines)}")
            
            if lines:
                logger.info(f"Sample Line Keys: {lines[0].keys()}")
                logger.info(f"Sample Line Details: {lines[0].get('BudgetDetails')}")

            for line in lines:
                account_id = line.get("AccountID")
                account_code = line.get("AccountCode")
                
                # Check for BudgetBalances (key name based on log debug)
                balances = line.get("BudgetBalances", [])
                
                for detail in balances:
                    period = detail.get("Period") 
                    # Fix: Xero returns YYYY-MM, Postgres needs YYYY-MM-DD
                    if len(period) == 7:
                        period = f"{period}-01"
                        
                    amount = detail.get("Amount")
                    
                    all_budget_data.append({
                        "budget_id": budget_id,
                        "budget_name": description,
                        "account_id": account_id,
                        "account_code": account_code,
                        "period_date": period,
                        "amount": amount,
                        "updated_at": datetime.utcnow()
                    })
        else:
            logger.warning(f"Failed to fetch details for budget {budget_id}")

    return all_budget_data

def upsert_budgets(conn, df):
    if df.empty:
        return
        
    logger.info(f"Upserting {len(df)} budget lines (aggregated)")
    
    with conn.cursor() as cur:
        # Full refresh for budgets
        cur.execute("TRUNCATE TABLE dw.fct_budget") 
        
        insert_query = """
            INSERT INTO dw.fct_budget (budget_id, month_date, amount, budget_name)
            VALUES (%s, %s, %s, %s)
        """
        
        import uuid
        for index, row in df.iterrows():
            cur.execute(insert_query, (str(uuid.uuid4()), row['period_date'], row['amount'], row['budget_name']))
            
    conn.commit()

def get_revenue_account_ids(client: XeroClient) -> set:
    """Fetch IDs of all Revenue accounts."""
    headers = client._auth_header()
    resp = requests.get(f"{API_BASE}/Accounts", headers=headers)
    resp.raise_for_status()
    accounts = resp.json().get("Accounts", [])
    
    revenue_ids = set()
    for acc in accounts:
        # Check Class or Type. 
        # Usually Class="REVENUE" or Type="SALES" / "REVENUE"
        if acc.get("Class") == "REVENUE" or acc.get("Type") in ["SALES", "REVENUE"]:
            revenue_ids.add(acc.get("AccountID"))
    
    logger.info(f"Identified {len(revenue_ids)} revenue accounts")
    return revenue_ids

def sync_budgets():
    load_dotenv(override=True)
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    
    creds = XeroCredentials(
        client_id=os.getenv("XERO_CLIENT_ID", ""),
        client_secret=os.getenv("XERO_CLIENT_SECRET", ""),
        tenant_id=os.getenv("XERO_TENANT_ID", ""),
        # Ensure we ask for sufficient scopes if new token needed, though we rely on existing mostly
        scopes=os.getenv("XERO_SCOPES", "accounting.transactions.read accounting.contacts.read accounting.budgets.read accounting.settings.read") 
    )
    
    if not conn_str:
        logger.error("SUPABASE_CONNECTION_STRING not set")
        return

    conn = None
    try:
        conn = connect(conn_str)
        client = XeroClient(creds, conn)
        
        # 1. Get Revenue Account IDs
        revenue_ids = get_revenue_account_ids(client)
        
        # 2. Fetch all budgets
        raw_budget_data = fetch_budgets(client)
        
        
        # 3. Filter for Revenue only
        revenue_budget_data = []
        for b in raw_budget_data:
            if b['account_id'] in revenue_ids:
                revenue_budget_data.append(b)
            else:
                 # Debug sample (log first 5 non-matches)
                 if len(revenue_budget_data) < 5 and b['account_code'] == '200': # Expected revenue code example?
                     logger.info(f"Skipping non-revenue budget line. Account: {b['account_code']} ({b['account_id']})")
                 pass
        
        logger.info(f"Filtered {len(raw_budget_data)} lines down to {len(revenue_budget_data)} revenue lines.")
        
        if not revenue_budget_data:
            logger.warning("No revenue budget data found.")
            # We might want to clear the table if no budget?
            # Or just return.
            return

        # 4. Aggregate by Budget Name and Month
        df = pd.DataFrame(revenue_budget_data)
        df['amount'] = pd.to_numeric(df['amount'])

        # Group by budget_name AND period_date to preserve individual budget identities
        aggregated = df.groupby(['budget_name', 'period_date'])['amount'].sum().reset_index()

        logger.info(f"Aggregated into {len(aggregated)} budget-month combinations across {aggregated['budget_name'].nunique()} budgets") 
        
        # 5. Upsert
        upsert_budgets(conn, aggregated)
        logger.info("Budget sync complete.")
        
    except Exception as e:
        logger.error(f"Sync failed: {e}", exc_info=True)
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    sync_budgets()
