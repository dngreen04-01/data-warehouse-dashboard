
import os
import argparse
import logging
import json
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
import google.generativeai as genai

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_db_connection():
    """Connect to the Supabase database."""
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise ValueError("SUPABASE_CONNECTION_STRING is not set")
    return psycopg.connect(conn_str, row_factory=dict_row)

def fetch_active_customers(conn):
    """Fetch list of active customers for context."""
    with conn.cursor() as cur:
        cur.execute("SELECT customer_id, customer_name FROM dw.dim_customer WHERE archived = false")
        return cur.fetchall()

def parse_email_with_gemini(email_text, customer_list):
    """Use Gemini to extract structured data from the email."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is not set")
    
    genai.configure(api_key=api_key)
    
    # Create a simplified list of customers for the prompt context
    # Limit to top 500 or so if list is huge, or just names to save tokens
    # unique names
    cust_names = [c['customer_name'] for c in customer_list]
    cust_context = "\n".join(cust_names[:1000]) # Limit context to reasonable size
    
    prompt = f"""
    You are a CRM Data Assistant. Your job is to parse a Sales Manager's email reply and extract structured data about unique customer interactions.
    
    **Input Email Text:**
    {email_text}
    
    **Valid Customer Context (Partial List):**
    {cust_context}
    
    **Instructions:**
    1. Identify every distinct customer mentioned. Match them to the 'Valid Customer Context' list if possible (fuzzy match). If no match found, use the name as written.
    2. For each customer, extract:
        - **customer_name**: The matched name or written name.
        - **notes**: Specific details/feedback about them.
        - **sentiment**: Positive, Negative, or Neutral.
        - **product_mention**: Any specific products mentioned for them.
        - **activity_type**: Did they Visit, Call, Email, Order, or is it just an Insight?
        - **action_required**: Boolean (True if the manager asks for something to be done).
    3. Also provide a specific **overall_summary** of the email and an **overall_sentiment_score** (-1.0 to 1.0).
    
    **Output Format:** JSON ONLY.
    {{
        "summary": "...",
        "sentiment_score": 0.5,
        "items": [
            {{
                "customer_name": "Farmlands Te Puke",
                "matched_name": "Farmlands - Te Puke", 
                "activity_type": "Visit",
                "notes": "Manager was unhappy about...",
                "sentiment": "Negative",
                "product_mention": "Ties",
                "action_required": true
            }}
        ]
    }}
    """
    
    model = genai.GenerativeModel('gemini-3-flash-preview')
    response = model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
    return json.loads(response.text)

def save_to_db(conn, author_email, email_text, parsed_data, customer_map):
    """Save the parsed data to the CRM tables."""
    with conn.cursor() as cur:
        # 1. Insert Interaction
        cur.execute("""
            INSERT INTO crm.interactions (author_email, original_text, summary, sentiment_score)
            VALUES (%s, %s, %s, %s)
            RETURNING interaction_id
        """, (author_email, email_text, parsed_data['summary'], parsed_data['sentiment_score']))
        
        interaction_id = cur.fetchone()['interaction_id']
        logger.info(f"Created Interaction ID: {interaction_id}")
        
        # 2. Insert Items
        for item in parsed_data['items']:
            # Try to resolve customer_id from the map
            matched_name = item.get('matched_name')
            customer_id = customer_map.get(matched_name)
            
            cur.execute("""
                INSERT INTO crm.interaction_items 
                (interaction_id, customer_id, customer_name_raw, product_mention, activity_type, notes, sentiment, action_required)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                interaction_id, 
                customer_id, 
                item['customer_name'], 
                item.get('product_mention'), 
                item.get('activity_type', 'Insight'), 
                item.get('notes'), 
                item.get('sentiment', 'Neutral'),
                item.get('action_required', False)
            ))
            
        conn.commit()
        logger.info(f"Saved {len(parsed_data['items'])} interaction items.")

def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Parse sales email reply into CRM.')
    parser.add_argument('--file', type=str, help='Path to text file containing email body')
    parser.add_argument('--text', type=str, help='Direct text string')
    parser.add_argument('--author', type=str, default='dave@klipon.co.nz', help='Author email')
    args = parser.parse_args()
    
    email_content = ""
    if args.file:
        with open(args.file, 'r') as f:
            email_content = f.read()
    elif args.text:
        email_content = args.text
    else:
        logger.error("Please provide --file or --text")
        return

    try:
        conn = get_db_connection()
        
        # 1. Fetch context
        customers = fetch_active_customers(conn)
        # Create a lookup map {name: id}
        customer_map = {c['customer_name']: c['customer_id'] for c in customers}
        
        # 2. Parse with AI
        logger.info("Parsing email with Gemini...")
        parsed_data = parse_email_with_gemini(email_content, customers)
        logger.info("Parsing complete.")
        print(json.dumps(parsed_data, indent=2))
        
        # 3. Save
        logger.info("Saving to database...")
        save_to_db(conn, args.author, email_content, parsed_data, customer_map)
        
    except Exception as e:
        logger.error(f"Process failed: {e}")
        raise
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    main()
