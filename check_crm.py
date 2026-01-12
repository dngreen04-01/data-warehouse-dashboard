
import os
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

load_dotenv()

conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
if not conn_str:
    print("Error: SUPABASE_CONNECTION_STRING not set")
    exit(1)

try:
    with psycopg.connect(conn_str, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            # Check for the most recent interaction
            cur.execute("""
                SELECT interaction_id, author_email, summary, sentiment_score, original_text 
                FROM crm.interactions 
                ORDER BY created_at DESC 
                LIMIT 1
            """)
            row = cur.fetchone()
            
            if row:
                print("\n--- Latest Interaction ---")
                print(f"ID: {row['interaction_id']}")
                print(f"Author: {row['author_email']}")
                print(f"Summary: {row['summary']}")
                print(f"Sentiment: {row['sentiment_score']}")
                print(f"Text: {row['original_text'][:50]}...")
                
                # Check items
                cur.execute("""
                    SELECT customer_name_raw, activity_type, sentiment, action_required 
                    FROM crm.interaction_items 
                    WHERE interaction_id = %s
                """, (row['interaction_id'],))
                items = cur.fetchall()
                print(f"\nItems found: {len(items)}")
                for item in items:
                    print(f"- {item['customer_name_raw']} ({item['activity_type']}): {item['sentiment']} [Action: {item['action_required']}]")
            else:
                print("No interactions found.")

except Exception as e:
    print(f"Database error: {e}")
