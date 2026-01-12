import os
import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row

def main():
    load_dotenv()
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        print("SUPABASE_CONNECTION_STRING not set")
        return

    try:
        with psycopg.connect(conn_str, row_factory=dict_row) as conn:
            print("--- Queue Content ---")
            cursor = conn.execute("SELECT * FROM dw.report_queue ORDER BY created_at DESC LIMIT 10")
            rows = cursor.fetchall()
            if not rows:
                print("No rows found in dw.report_queue.")
            for row in rows:
                print(row)
                
            print("\n--- Subscription Content ---")
            cursor = conn.execute("SELECT * FROM dw.email_subscriptions")
            rows = cursor.fetchall()
            for row in rows:
                print(row)

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
