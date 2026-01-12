import time
import logging
import os
import psycopg
from dotenv import load_dotenv
from src.reporting.sales_report import process_queue, get_db_connection

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("ReportWorker")

def run_worker():
    load_dotenv()
    sg_key = os.getenv("SENDGRID_API_KEY")
    if not sg_key:
        logger.error("SENDGRID_API_KEY is not set. Worker cannot send emails.")
        return

    logger.info("Starting Report Worker...")
    
    while True:
        try:
            conn = get_db_connection()
            # Process any pending items
            process_queue(conn, sg_key)
            conn.close()
        except Exception as e:
            logger.error(f"Worker iteration failed: {e}")
        
        # Wait for 60 seconds before next check
        time.sleep(60)

if __name__ == "__main__":
    run_worker()
