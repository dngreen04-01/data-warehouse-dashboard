import os
import psycopg

conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
if not conn_str:
    raise RuntimeError("SUPABASE_CONNECTION_STRING is not configured")

with open("supabase/inventory.sql", "r") as f:
    sql = f.read()

with psycopg.connect(conn_str) as conn:
    with conn.cursor() as cur:
        cur.execute(sql)
        conn.commit()
