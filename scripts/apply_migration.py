import os
import psycopg
from dotenv import load_dotenv

def apply_migration():
    load_dotenv(override=True)
    
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        print("Error: SUPABASE_CONNECTION_STRING not found in environment.")
        return

    migration_file = "supabase/migrations/20251212_statement_filtering.sql"
    
    try:
        with open(migration_file, 'r') as f:
            sql_content = f.read()
            
        print(f"Connecting to database...")
        with psycopg.connect(conn_str) as conn:
            with conn.cursor() as cur:
                print(f"Applying migration: {migration_file}")
                cur.execute(sql_content)
            conn.commit()
            print("Migration applied successfully.")
            
    except Exception as e:
        print(f"Error applying migration: {e}")

if __name__ == "__main__":
    apply_migration()
