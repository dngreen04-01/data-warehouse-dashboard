
import os
import psycopg
from dotenv import load_dotenv

load_dotenv()

conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
if not conn_str:
    print("Error: SUPABASE_CONNECTION_STRING not set")
    exit(1)

migration_file = "supabase/migrations/20251224_crm_tasks.sql"

try:
    with open(migration_file, 'r') as f:
        sql = f.read()

    with psycopg.connect(conn_str) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()
    print(f"Successfully applied {migration_file}")

except Exception as e:
    print(f"Migration failed: {e}")
