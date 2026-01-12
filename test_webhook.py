
import requests

url = "https://byyatoaijymbpbkuuiqi.supabase.co/functions/v1/inbound-parse"

# Simulate SendGrid Payload
payload = {
    "from": "dave@klipon.co.nz",
    "subject": "Re: Weekly Sales",
    "text": "Farmlands Te Puke is really happy with the new stock. Please send them 50 more units."
}

try:
    print(f"Sending mock request to {url}...")
    # SendGrid sends as multipart/form-data, but requests handles `data` as form-encoded
    # or `files` for multipart. Let's try simple post first as Supabase handles both usually
    # but strictly SendGrid uses multipart.
    
    # Using files parameter to force multipart/form-data structure for text fields is a trick in requests,
    # or just use 'data' for normal form fields if the boundary is handled.
    
    response = requests.post(url, data=payload)
    
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
    
    if response.status_code == 200:
        print("SUCCESS: Webhook processed the email.")
    else:
        print("FAILURE: Webhook returned error.")

except Exception as e:
    print(f"Error: {e}")
