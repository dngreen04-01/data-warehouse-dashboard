import os
import logging
import datetime
import argparse
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, ReplyTo

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_db_connection():
    """Connect to the Supabase database."""
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise ValueError("SUPABASE_CONNECTION_STRING is not set")
    return psycopg.connect(conn_str, row_factory=dict_row)

def get_weekly_orders(conn, start_date, end_date):
    """
    Fetch all sales orders for the last week.
    List out: Customer, Products, Total Value.
    """
    query = """
        SELECT
            customer_name,
            invoice_date,
            invoice_number,
            item_name,
            qty,
            line_amount
        FROM mart.sales_enriched
        WHERE invoice_date >= %s AND invoice_date <= %s
        ORDER BY invoice_date DESC, customer_name, item_name
    """
    try:
        cursor = conn.execute(query, [start_date, end_date])
        return pd.DataFrame(cursor.fetchall())
    except Exception as e:
        logger.error(f"Error fetching weekly orders: {e}")
        return pd.DataFrame()

def get_customer_summary(weekly_df):
    """
    Summarise by customer: Products ordered (concat), Total Value.
    """
    if weekly_df.empty:
        return pd.DataFrame()

    # Group by Customer
    summary = weekly_df.groupby('customer_name').agg(
        products_ordered=('item_name', lambda x: ', '.join(x.unique())[:100] + '...' if len(','.join(x.unique())) > 100 else ', '.join(x.unique())),
        total_value=('line_amount', 'sum'),
        order_count=('invoice_number', 'nunique')
    ).reset_index()
    
    return summary.sort_values('total_value', ascending=False)

def get_mtd_comparison(conn, current_start, current_end, prev_start, prev_end):
    """
    Customer sales value MTD vs Equivalent Period Last Year.
    """
    # Fetch Data for both periods
    query = """
        SELECT
            customer_name,
            SUM(line_amount) as total_sales
        FROM mart.sales_enriched
        WHERE invoice_date >= %s AND invoice_date <= %s
        GROUP BY customer_name
    """
    
    try:
        # Current Period
        cur = conn.execute(query, [current_start, current_end])
        curr_df = pd.DataFrame(cur.fetchall())
        if not curr_df.empty:
            curr_df = curr_df.set_index('customer_name')
            curr_df.rename(columns={'total_sales': 'current_sales'}, inplace=True)
        else:
            curr_df = pd.DataFrame(columns=['current_sales'])

        # Previous Period
        cur = conn.execute(query, [prev_start, prev_end])
        prev_df = pd.DataFrame(cur.fetchall())
        if not prev_df.empty:
            prev_df = prev_df.set_index('customer_name')
            prev_df.rename(columns={'total_sales': 'last_year_sales'}, inplace=True)
        else:
            prev_df = pd.DataFrame(columns=['last_year_sales'])
        
        # Merge
        combined = curr_df.join(prev_df, how='outer').fillna(0)
        combined['diff'] = combined['current_sales'] - combined['last_year_sales']
        # Calculate pct change safely
        combined['pct_change'] = (combined['diff'] / combined['last_year_sales'].replace(0, 1)) * 100
        combined.loc[combined['last_year_sales'] == 0, 'pct_change'] = 100 # New growth

        # Sort by current sales and reset index to show customer name as column
        result = combined.sort_values('current_sales', ascending=False).reset_index()
        result.rename(columns={
            'customer_name': 'Customer',
            'current_sales': 'Current Sales',
            'last_year_sales': 'Last Year Sales',
            'diff': 'Diff',
            'pct_change': '% Change'
        }, inplace=True)
        return result

    except Exception as e:
        logger.error(f"Error fetching MTD comparison: {e}")
        return pd.DataFrame()

def df_to_html_table(df, title=None):
    """Convert dataframe to styled HTML table (optimized with list comprehension)."""
    if df.empty:
        return f"<p>No data for {title}</p>"

    def format_cell(val, col):
        """Format a cell value based on column type."""
        # Skip formatting for non-numeric columns
        if any(x in col for x in ['name', 'date', 'code', 'invoice']):
            return str(val)

        # Handle NaN values
        try:
            if pd.isna(val):
                return ''
            num_val = float(val)
        except (ValueError, TypeError):
            return str(val)

        # Format based on column type
        if 'pct' in col:
            return f"{num_val:,.0f}%"
        elif 'count' in col or 'qty' in col:
            return f"{num_val:,.0f}"
        else:
            return f"${num_val:,.0f}"

    # Build header row
    header_cells = ''.join(f"<th>{col.replace('_', ' ').title()}</th>" for col in df.columns)

    # Build body rows using list comprehension (much faster than iterrows)
    body_rows = []
    for row in df.values:  # df.values is a NumPy array - faster than iterrows
        cells = ''.join(f"<td>{format_cell(val, col)}</td>" for val, col in zip(row, df.columns))
        body_rows.append(f"<tr>{cells}</tr>")

    # Assemble HTML
    parts = [
        f"<h4>{title}</h4>" if title else "",
        '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; font-size: 12px;">',
        f'<thead><tr style="background-color: #f2f2f2;">{header_cells}</tr></thead>',
        '<tbody>',
        '\n'.join(body_rows),
        '</tbody></table>'
    ]
    return ''.join(parts)

def generate_short_summary(customer_summary, mtd_comparison, start_date, end_date):
    """Generate Short Summary HTML."""
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif;">
        <h2>Weekly Sales Summary (Short)</h2>
        <p>Period: {start_date} to {end_date}</p>
        <hr>
        {df_to_html_table(customer_summary.head(10), "Top 10 Customers by Weekly Revenue")}
        <br>
        {df_to_html_table(mtd_comparison.head(10), "Top 10 Customers (MTD vs Last Year)")}
        <p><em>*Showing top 10 only.</em></p>
    </body>
    </html>
    """
    return html

def generate_detailed_summary(weekly_orders, mtd_comparison, start_date, end_date):
    """Generate Detailed Summary HTML."""
    # Process weekly orders for display
    display_orders = weekly_orders[['invoice_date', 'customer_name', 'item_name', 'qty', 'line_amount']].copy()
    
    html = f"""
    <html>
    <body style="font-family: Arial, sans-serif;">
        <h2>Weekly Sales Summary (Detailed)</h2>
        <p>Period: {start_date} to {end_date}</p>
        <hr>
        {df_to_html_table(mtd_comparison.head(20), "Customer Performance (MTD vs Last Year - Top 20)")}
        <br>
        <h3>Detailed Sales Orders (Last Week)</h3>
        {df_to_html_table(display_orders, "All Orders")}
    </body>
    </html>
    """
    return html

def send_email(recipient, subject, html_content, api_key):
    """Send email via SendGrid."""
    message = Mail(
        from_email='damien.green@brands.co.nz',
        to_emails=recipient,
        subject=subject,
        html_content=html_content
    )
    # Set reply-to addresses (CRM parser processes it, Damien gets a copy)
    message.reply_to_list = [
        ReplyTo(email='crm@parse.finalmile.co.nz', name='CRM System'),
        ReplyTo(email='damien.green@brands.co.nz', name='Damien Green'),
    ]
    try:
        sg = SendGridAPIClient(api_key)
        response = sg.send(message)
        logger.info(f"Email sent to {recipient}! Status: {response.status_code}")
    except Exception as e:
        logger.error(f"Failed to send email to {recipient}: {e}")

def get_default_week_dates():
    """Calculate last week's Monday-Sunday dates."""
    today = datetime.date.today()
    week_start = today - datetime.timedelta(days=today.weekday() + 7)
    week_end = week_start + datetime.timedelta(days=6)
    return week_start, week_end


def process_queue(conn, sg_key):
    """
    Check dw.report_queue for pending requests and process them.
    Supports custom date ranges per queue item.
    """
    try:
        # Fetch pending items including optional date columns
        cursor = conn.execute(
            "SELECT id, email, report_type, start_date, end_date "
            "FROM dw.report_queue WHERE status = 'pending' FOR UPDATE SKIP LOCKED"
        )
        items = cursor.fetchall()

        if not items:
            logger.info("No pending items in queue.")
            return

        for item in items:
            item_id = item['id']
            recipient = item['email']
            report_type = item['report_type']

            # Use provided dates or fall back to last week
            if item.get('start_date') and item.get('end_date'):
                week_start = item['start_date']
                week_end = item['end_date']
            else:
                week_start, week_end = get_default_week_dates()

            logger.info(f"Processing queue item {item_id} for {recipient} ({report_type}), period: {week_start} to {week_end}...")

            try:
                # Update status to processing
                conn.execute("UPDATE dw.report_queue SET status = 'processing', processed_at = now() WHERE id = %s", [item_id])
                conn.commit()

                # Calculate MTD periods based on the week end date
                mtd_start = week_end.replace(day=1)
                mtd_end = week_end
                prev_mtd_start = mtd_start.replace(year=mtd_start.year - 1)
                prev_mtd_end = mtd_end.replace(year=mtd_end.year - 1)

                # Fetch data for this specific date range
                weekly_orders = get_weekly_orders(conn, week_start, week_end)
                customer_summary = get_customer_summary(weekly_orders)
                mtd_comparison = get_mtd_comparison(conn, mtd_start, mtd_end, prev_mtd_start, prev_mtd_end)

                if report_type == 'short':
                    html = generate_short_summary(customer_summary, mtd_comparison, week_start, week_end)
                    subject = f"Weekly Sales Summary (Short) - {week_end}"
                else:
                    html = generate_detailed_summary(weekly_orders, mtd_comparison, week_start, week_end)
                    subject = f"Weekly Sales Summary (Detailed) - {week_end}"

                send_email(recipient, subject, html, sg_key)

                # Update status to completed
                conn.execute("UPDATE dw.report_queue SET status = 'completed' WHERE id = %s", [item_id])
                conn.commit()
                logger.info(f"Queue item {item_id} completed.")

            except Exception as e:
                logger.error(f"Failed to process item {item_id}: {e}")
                conn.execute("UPDATE dw.report_queue SET status = 'failed', error_message = %s WHERE id = %s", [str(e), item_id])
                conn.commit()

    except Exception as e:
        logger.error(f"Error processing queue: {e}")

def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Send weekly sales performance report.')
    parser.add_argument('--dry-run', action='store_true', help='Run without sending emails')
    parser.add_argument('--process-queue', action='store_true', help='Process pending items from the queue')
    args = parser.parse_args()

    # If processing queue, run that logic exclusively or in addition?
    # Logic: If --process-queue is passed, do that. Else do the scheduled run.
    
    sg_key = os.getenv("SENDGRID_API_KEY")
    
    try:
        conn = get_db_connection()
        
        if args.process_queue:
            if not sg_key:
                logger.error("SENDGRID_API_KEY is not set")
                return
            process_queue(conn, sg_key)
            return

        # Regular Scheduled Logic
        # Dates
        today = datetime.date.today()
        week_start = today - datetime.timedelta(days=today.weekday() + 7)
        week_end = week_start + datetime.timedelta(days=6)
        
        mtd_start = week_end.replace(day=1)
        mtd_end = week_end
        prev_mtd_start = mtd_start.replace(year=mtd_start.year - 1)
        prev_mtd_end = mtd_end.replace(year=mtd_end.year - 1)

        logger.info(f"Reporting Period: Week {week_start} - {week_end}")
        
        # 1. Fetch Data
        logger.info("Fetching data...")
        weekly_orders = get_weekly_orders(conn, week_start, week_end)
        customer_summary = get_customer_summary(weekly_orders)
        mtd_comparison = get_mtd_comparison(conn, mtd_start, mtd_end, prev_mtd_start, prev_mtd_end)
        
        # 2. Fetch Subscriptions
        if args.dry_run:
             # Dry run: fake subscription
             subs = [{'email': 'test@example.com', 'report_type': 'short'}, {'email': 'test@example.com', 'report_type': 'detailed'}]
        else:
             cursor = conn.execute("SELECT email, report_type FROM dw.email_subscriptions WHERE is_active = true")
             subs = cursor.fetchall()
        
        if not subs:
            logger.info("No active subscriptions found.")
            return

        # 3. Generate and Send
        for sub in subs:
            recipient = sub['email']
            report_type = sub['report_type']
            logger.info(f"Processing for {recipient} ({report_type})...")
            
            if report_type == 'short':
                html = generate_short_summary(customer_summary, mtd_comparison, week_start, week_end)
                subject = f"Weekly Sales Summary (Short) - {week_end}"
            else:
                html = generate_detailed_summary(weekly_orders, mtd_comparison, week_start, week_end)
                subject = f"Weekly Sales Summary (Detailed) - {week_end}"
            
            if args.dry_run:
                logger.info(f"[Dry Run] Would send {report_type} email to {recipient}")
                fn = f"dry_run_{report_type}.html"
                with open(fn, "w") as f:
                    f.write(html)
                logger.info(f"Saved {fn}")
            else:
                if not sg_key:
                     logger.warning("SENDGRID_API_KEY missing, skipping send.")
                     continue
                send_email(recipient, subject, html, sg_key)
                
    except Exception as e:
        logger.error(f"Process failed: {e}")
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    main()
