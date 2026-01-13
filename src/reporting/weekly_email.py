

import os
import logging
import datetime
import argparse
import base64
import json
import time
from functools import wraps
import requests
import pandas as pd
import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, Attachment, FileContent, FileName, FileType, Disposition, ReplyTo
import google.generativeai as genai


def retry_with_backoff(max_retries=3, initial_delay=1.0, backoff_multiplier=2.0):
    """Decorator for retrying functions with exponential backoff."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            delay = initial_delay
            last_exception = None

            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries - 1:
                        logger.warning(f"{func.__name__} attempt {attempt + 1} failed: {e}. Retrying in {delay:.1f}s...")
                        time.sleep(delay)
                        delay *= backoff_multiplier
                    else:
                        logger.error(f"{func.__name__} failed after {max_retries} attempts: {e}")

            raise last_exception
        return wrapper
    return decorator

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_db_connection():
    """Connect to the Supabase database."""
    conn_str = os.getenv("SUPABASE_CONNECTION_STRING")
    if not conn_str:
        raise ValueError("SUPABASE_CONNECTION_STRING is not set")
    return psycopg.connect(conn_str, row_factory=dict_row)

def get_sales_data(conn, start_date, end_date, market_filter=None):
    """Fetch sales data from mart.sales_enriched for a given date range."""
    query = """
        SELECT
            customer_name,
            product_code,
            item_name,
            market,
            cluster_label,
            invoice_date,
            line_amount,
            qty
        FROM mart.sales_enriched
        WHERE invoice_date >= %s AND invoice_date <= %s
    """
    params = [start_date, end_date]
    
    if market_filter:
        query += " AND market = %s"
        params.append(market_filter)
        
    cursor = conn.execute(query, params)
    return pd.DataFrame(cursor.fetchall())

def analyze_period(current_df, prev_df, period_name):
    """Analyze a specific period (Week, MTD, YTD)."""
    current_total = current_df['line_amount'].sum() if not current_df.empty else 0.0
    prev_total = prev_df['line_amount'].sum() if not prev_df.empty else 0.0
    diff = current_total - prev_total
    
    # Analyze movers only if we have data
    top_customers = pd.DataFrame()
    top_products = pd.DataFrame()
    
    if not current_df.empty or not prev_df.empty:
        # Customers
        curr_cust = current_df.groupby('customer_name')['line_amount'].sum()
        prev_cust = prev_df.groupby('customer_name')['line_amount'].sum()
        cust_comp = pd.DataFrame({'current': curr_cust, 'previous': prev_cust}).fillna(0)
        cust_comp['diff'] = cust_comp['current'] - cust_comp['previous']
        top_customers = cust_comp.sort_values('diff', ascending=False)
        
        # Products
        curr_prod = current_df.groupby('item_name')['line_amount'].sum()
        prev_prod = prev_df.groupby('item_name')['line_amount'].sum()
        prod_comp = pd.DataFrame({'current': curr_prod, 'previous': prev_prod}).fillna(0)
        prod_comp['diff'] = prod_comp['current'] - prod_comp['previous']
        top_products = prod_comp.sort_values('diff', ascending=False)
        
    return {
        'period': period_name,
        'current_total': current_total,
        'prev_total': prev_total,
        'diff': diff,
        'top_customers_growth': top_customers.head(5) if not top_customers.empty else pd.DataFrame(),
        'top_customers_decline': top_customers.tail(5).sort_values('diff', ascending=True) if not top_customers.empty else pd.DataFrame(),
        'top_products_growth': top_products.head(5) if not top_products.empty else pd.DataFrame(),
        'top_products_decline': top_products.tail(5).sort_values('diff', ascending=True) if not top_products.empty else pd.DataFrame()
    }

@retry_with_backoff(max_retries=3, initial_delay=1.0, backoff_multiplier=2.0)
def generate_chart_image(summary_data):
    """Generate a chart using Gemini 3 Pro Image Preview via REST API.

    Includes retry logic with exponential backoff for resilience.
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError("GOOGLE_API_KEY is not set")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key={api_key}"

    # Construct data string for the prompt
    data_desc = ""
    for p in ['Week', 'MTD', 'YTD']:
        data = summary_data[p]
        data_desc += f"{p}: This Year=${data['current_total']:.0f}, Last Year=${data['prev_total']:.0f}. "

    prompt = (
        f"Create a professional, clean grouped bar chart comparing This Year vs Last Year sales. "
        f"Data: {data_desc} "
        "Use a modern color palette: Blue for 'This Year' and Light Grey for 'Last Year'. "
        "Add clear data labels on the bars. White background. No grid lines. "
        "Title: 'Sales Performance Comparison'. "
        "Make it look like a high-end financial dashboard widget."
    )

    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {"aspectRatio": "16:9"}
        }
    }

    # Add timeout to prevent hanging requests
    response = requests.post(url, json=payload, timeout=60)

    if response.status_code != 200:
        raise RuntimeError(f"Image generation failed with status {response.status_code}: {response.text}")

    # Extract base64 image from response
    # Structure: candidates[0].content.parts[0].inlineData.data
    result = response.json()
    image_data = result['candidates'][0]['content']['parts'][0]['inlineData']['data']
    return image_data

@retry_with_backoff(max_retries=3, initial_delay=1.0, backoff_multiplier=2.0)
def generate_narrative(summary_data, start_date, end_date, model_name='gemini-3-flash-preview'):
    """Generate text narrative using Gemini.

    Includes retry logic with exponential backoff for resilience.
    """
    api_key = os.getenv("GOOGLE_API_KEY")
    genai.configure(api_key=api_key)

    # Prepare data summary for the prompt
    week_data = summary_data['Week']

    prompt = f"""
    You are an AI assistant for a sales manager. Write the "Executive Summary" and "Key Drivers" sections for a weekly sales email.

    **Context:**
    - Period: Week of {start_date} to {end_date}
    - Market: Local

    **Data:**
    - Weekly Sales: ${week_data['current_total']:,.2f} (vs ${week_data['prev_total']:,.2f} Last Year)
    - MTD Sales: ${summary_data['MTD']['current_total']:,.2f} (vs ${summary_data['MTD']['prev_total']:,.2f})
    - YTD Sales: ${summary_data['YTD']['current_total']:,.2f} (vs ${summary_data['YTD']['prev_total']:,.2f})

    **Top Movers (Week):**
    - Growth Customers: {week_data['top_customers_growth'].to_dict().get('diff', {})}
    - Decline Customers: {week_data['top_customers_decline'].to_dict().get('diff', {})}
    - Growth Products: {week_data['top_products_growth'].to_dict().get('diff', {})}
    - Decline Products: {week_data['top_products_decline'].to_dict().get('diff', {})}

    **Instructions:**
    1. **Executive Summary**: 2-3 sentences highlighting the overall performance (Week/MTD/YTD) and the trend.
    2. **Key Drivers**: Briefly explain the "Why" based on the movers. Mention specific large drops or gains.
    3. **Tone**: Professional, concise, insightful.
    4. **Output Format**: HTML paragraphs (<p>) and bold tags (<strong>). NO Markdown. NO headers.
    """

    model = genai.GenerativeModel(model_name)
    response = model.generate_content(prompt)
    return response.text

def df_to_html_table(df, title):
    """Convert dataframe to styled HTML table (optimized with list comprehension)."""
    if df.empty:
        return f"<p>No data for {title}</p>"

    # Format currency using vectorized operations
    df_copy = df.copy()
    if 'current' in df_copy.columns:
        df_copy['current'] = df_copy['current'].apply(lambda x: f"${x:,.0f}")
    if 'previous' in df_copy.columns:
        df_copy['previous'] = df_copy['previous'].apply(lambda x: f"${x:,.0f}")
    if 'diff' in df_copy.columns:
        # Store original diff for color determination before formatting
        df_copy['_is_positive'] = df['diff'] >= 0
        df_copy['diff'] = df_copy['diff'].apply(lambda x: f"${x:,.0f}")

    # Build header
    header = "<thead><tr style='background-color:#f2f2f2;'><th>Name</th><th>This Year</th><th>Last Year</th><th>Diff</th></tr></thead>"

    # Build body rows using list comprehension (much faster than iterrows)
    body_rows = []
    for idx, (current, previous, diff, is_pos) in zip(
        df_copy.index,
        zip(df_copy['current'].values, df_copy['previous'].values,
            df_copy['diff'].values, df_copy.get('_is_positive', [True] * len(df_copy)).values)
    ):
        color = "color:green;" if is_pos else "color:red;"
        body_rows.append(
            f"<tr><td>{idx}</td><td>{current}</td><td>{previous}</td>"
            f"<td style='{color}'><strong>{diff}</strong></td></tr>"
        )

    # Assemble HTML
    html = f"<h4>{title}</h4><table border='1' cellspacing='0' cellpadding='5' style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:12px;'>"
    html += header + "<tbody>" + "".join(body_rows) + "</tbody></table>"
    return html

def send_email_via_sendgrid(html_content, recipient, image_data=None):
    """Send the email using SendGrid."""
    sg_api_key = os.getenv("SENDGRID_API_KEY")
    if not sg_api_key:
        raise ValueError("SENDGRID_API_KEY is not set")
        
    message = Mail(
        from_email='damien.green@brands.co.nz',
        to_emails=recipient,
        subject='Weekly Sales Performance Report',
        html_content=html_content
    )
    # Set reply-to addresses (Damien gets a copy, CRM parser processes it)
    message.reply_to_list = [
        ReplyTo(email='damien.green@brands.co.nz', name='Damien Green'),
        ReplyTo(email='crm@parse.finalmile.co.nz', name='CRM System'),
    ]
    
    if image_data:
        attachment = Attachment()
        attachment.file_content = FileContent(image_data)
        attachment.file_type = FileType('image/png')
        attachment.file_name = FileName('sales_chart.png')
        attachment.disposition = Disposition('inline')
        attachment.content_id = 'sales_chart'
        message.add_attachment(attachment)
    
    try:
        sg = SendGridAPIClient(sg_api_key)
        response = sg.send(message)
        logger.info(f"Email sent! Status Code: {response.status_code}")
    except Exception as e:
        logger.error(f"Error sending email: {e}")
        raise

def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description='Send weekly sales email.')
    parser.add_argument('--dry-run', action='store_true', help='Run without sending email or calling AI')
    parser.add_argument('--model', type=str, default='gemini-3-flash-preview', help='Gemini model to use')
    parser.add_argument('--recipient', type=str, default='Dave@Klipon.co.nz', help='Email recipient')
    args = parser.parse_args()
    
    # 1. Determine Date Ranges
    today = datetime.date.today()
    
    # Week: Last Monday to Last Sunday
    week_start = today - datetime.timedelta(days=today.weekday() + 7)
    week_end = week_start + datetime.timedelta(days=6)
    
    # MTD: 1st of current month to today (or end of reporting week)
    # Let's use up to week_end to be consistent with the report "completeness"
    mtd_start = week_end.replace(day=1)
    mtd_end = week_end
    
    # YTD: Jan 1 to week_end
    ytd_start = week_end.replace(month=1, day=1)
    ytd_end = week_end
    
    # Previous Year Dates
    prev_week_start = week_start.replace(year=week_start.year - 1)
    prev_week_end = week_end.replace(year=week_end.year - 1)
    
    prev_mtd_start = mtd_start.replace(year=mtd_start.year - 1)
    prev_mtd_end = mtd_end.replace(year=mtd_end.year - 1)
    
    prev_ytd_start = ytd_start.replace(year=ytd_start.year - 1)
    prev_ytd_end = ytd_end.replace(year=ytd_end.year - 1)
    
    logger.info(f"Reporting Dates (Week): {week_start} to {week_end}")
    
    try:
        conn = get_db_connection()
        
        # 2. Fetch Data
        summary = {}
        periods = [
            ('Week', week_start, week_end, prev_week_start, prev_week_end),
            ('MTD', mtd_start, mtd_end, prev_mtd_start, prev_mtd_end),
            ('YTD', ytd_start, ytd_end, prev_ytd_start, prev_ytd_end)
        ]
        
        for name, curr_s, curr_e, prev_s, prev_e in periods:
            df_curr = get_sales_data(conn, curr_s, curr_e, market_filter='Local')
            df_prev = get_sales_data(conn, prev_s, prev_e, market_filter='Local')
            summary[name] = analyze_period(df_curr, df_prev, name)

        # 3. Generate Chart (Gemini)
        image_data = None
        if not args.dry_run:
            logger.info("Generating chart with Gemini 3 Pro Image Preview...")
            image_data = generate_chart_image(summary)
            
        # 4. Generate Narrative (Gemini)
        narrative_html = "<p>[Dry Run Narrative]</p>"
        if not args.dry_run:
            logger.info("Generating narrative with Gemini...")
            narrative_html = generate_narrative(summary, week_start, week_end, model_name=args.model)
            
        # 5. Build HTML Email
        # Tables for the Week
        week_stats = summary['Week']
        week_tables_html = """
        <table width="100%" cellpadding="10" border="0">
            <tr>
                <td valign="top" width="50%">""" + df_to_html_table(week_stats['top_customers_growth'], "Top Customer Growth (Week)") + """</td>
                <td valign="top" width="50%">""" + df_to_html_table(week_stats['top_products_growth'], "Top Product Growth (Week)") + """</td>
            </tr>
            <tr>
                <td valign="top" width="50%">""" + df_to_html_table(week_stats['top_customers_decline'], "Top Customer Decline (Week)") + """</td>
                <td valign="top" width="50%">""" + df_to_html_table(week_stats['top_products_decline'], "Top Product Decline (Week)") + """</td>
            </tr>
        </table>
        """

        # Tables for MTD
        mtd_stats = summary['MTD']
        mtd_tables_html = """
        <table width="100%" cellpadding="10" border="0">
            <tr>
                <td valign="top" width="50%">""" + df_to_html_table(mtd_stats['top_customers_growth'], "Top Customer Growth (MTD)") + """</td>
                <td valign="top" width="50%">""" + df_to_html_table(mtd_stats['top_products_growth'], "Top Product Growth (MTD)") + """</td>
            </tr>
            <tr>
                <td valign="top" width="50%">""" + df_to_html_table(mtd_stats['top_customers_decline'], "Top Customer Decline (MTD)") + """</td>
                <td valign="top" width="50%">""" + df_to_html_table(mtd_stats['top_products_decline'], "Top Product Decline (MTD)") + """</td>
            </tr>
        </table>
        """
        
        email_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
            <h2>Weekly Sales Performance Report</h2>
            <p style="color: #666;">Period: {week_start} to {week_end} | Market: Local</p>
            
            <hr>
            <h3>Executive Summary</h3>
            {narrative_html}
            
            <hr>
            <h3>Performance Overview</h3>
            <div style="text-align: center; padding: 20px;">
                <img src="cid:sales_chart" alt="Sales Chart" style="max-width: 100%; border: 1px solid #ddd; padding: 5px;">
            </div>
            
            <hr>
            <h3>Weekly Movers Analysis</h3>
            {week_tables_html}

            <hr>
            <h3>Month-to-Date (MTD) Movers Analysis</h3>
            {mtd_tables_html}
            
            <hr>
            <p style="background-color: #e8f0fe; padding: 15px; border-radius: 5px;">
                <strong>Action Required:</strong><br>
                Please reply with your feedback on why these trends may have happened and list your activities from the last week.
            </p>
        </body>
        </html>
        """

        if args.dry_run:
            logger.info("Dry Run Mode - Saving outputs locally.")
            with open("dry_run_last_email.html", "w") as f:
                f.write(email_body)
            logger.info("Saved dry_run_last_email.html")
            print("--- Analysis Summary ---")
            for k, v in summary.items():
                print(f"{k}: ${v['current_total']:,.0f} vs ${v['prev_total']:,.0f}")
        else:
            send_email_via_sendgrid(email_body, recipient=args.recipient, image_data=image_data)
        
    except Exception as e:
        logger.error(f"Process failed: {e}")
        raise
    finally:
        if 'conn' in locals():
            conn.close()

if __name__ == "__main__":
    main()


