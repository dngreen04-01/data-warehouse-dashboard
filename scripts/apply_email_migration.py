import os
import psycopg
from dotenv import load_dotenv
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def apply_migration(sql_file_path):
    load_dotenv()
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        logger.error("SUPABASE_CONNECTION_STRING not set")
        return

    try:
        with open(sql_file_path, 'r') as f:
            sql = f.read()
        
        with psycopg.connect(conn_str) as conn:
            conn.execute(sql)
            logger.info(f"Successfully applied {sql_file_path}")
            
    except Exception as e:
        logger.error(f"Failed to apply migration: {e}")

if __name__ == "__main__":
    # List of migrations to apply
    migrations = [
        'supabase/migrations/20251224_email_subscriptions.sql',
        'supabase/migrations/20251224_email_api.sql'
    ]
    
    workspace_path = '/Users/damiengreen/Desktop/Data Warehouse'
    
    for migration_file in migrations:
        full_path = os.path.join(workspace_path, migration_file)
        if os.path.exists(full_path):
            apply_migration(full_path)
        else:
             logger.warning(f"File not found: {full_path}")
