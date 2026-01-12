# SendGrid Inbound Email Setup Guide

To enable the "Reply-to-CRM" functionality, you need to configure SendGrid to catch email replies and forward them to our system.

## 1. Choose a Subdomain
You cannot use your root domain (e.g., `brands.co.nz`) for inbound parsing effectively without affecting your main email. You should use a subdomain.
**Recommended**: `parse.brands.co.nz` or `crm.brands.co.nz`.

## 2. Add MX Record (DNS)
Log in to your DNS provider (e.g., GoDaddy, Cloudflare) and add an MX record for your chosen subdomain:
*   **Type**: MX
*   **Host**: `parse` (if using `parse.brands.co.nz`)
*   **Value**: `mx.sendgrid.net.`
*   **Priority**: 10

## 3. Configure SendGrid Inbound Parse
1.  Log in to your SendGrid dashboard.
2.  Navigate to **Settings** > **Inbound Parse**.
3.  Click **Add Host & URL**.
4.  **Receiving Domain**: Select the subdomain you set up (e.g., `parse.brands.co.nz`).
    *   *Note: You might need to verify this domain first in Sender Authentication settings.*
5.  **Destination URL**: This is where SendGrid will POST the email content.
    *   *Since we are currently running locally/on-prem, you need a public URL.*
    *   **Option A (Dev/Test)**: Use [ngrok](https://ngrok.com/) to tunnel to your local machine (`ngrok http 8000`).
    *   **Option B (Production)**: Deploy a serverless function (e.g., Supabase Edge Function, AWS Lambda) or a simple API that receives the POST request and calls our `parse_reply.py` logic.

## 4. Updates to Our Code
I have already updated `src/reporting/weekly_email.py` to set the `Reply-To` header:
```python
message.reply_to = 'crm-reply@parse.brands.co.nz'
```
*Note: Ensure the email address matches the receiving domain you configured above.*

## 5. Next Steps for Implementation
To make this live, we need to deploy the "Receiver" endpoint.
1.  **Deploy** a small Flask/FastAPI app or a Cloud Function.
2.  **Endpoint Logic**:
    *   Receive POST from SendGrid.
    *   Extract `text` and `from` fields.
    *   Run the Gemini parsing logic (from `src/crm/parse_reply.py`).
    *   Insert into Supabase.

Let me know when you have the MX record set up!
