# Bancard Backend API - Curl Test Commands

Use these commands to test the API endpoints.

**Prerequisites:**
1.  Ensure the server is running: `npm run dev`
2.  Ensure MongoDB is running.
3.  **Replace placeholders** like `<TRANSACTION_ID>` with actual values returned from the API.

---

## 1. Create a Transaction

This initiates a payment and creates a record in your local MongoDB.

```bash
curl -X POST http://localhost:3000/api/bancard/create \
  -H "Content-Type: application/json" \
  -d '{
    "eid": "1",
    "amount": 10000,
    "currency": "PYG",
    "description": "Test Consultation",
    "metadata": { "patient_id": "123" },
    "returnUrl": "http://localhost:3000/callback",
    "pgMetadata": {},
    "paymentMethod": "credit_card",
    "locale": "es"
  }'
```

**Response:**
You will receive a JSON object with a `process_id` and a transaction `id`.
**Copy the transaction `id`** (e.g., `65c4...`) for the next steps.

---

## 2. Get Transaction Status

Check the status of the transaction using the ID you just received.

```bash
# Replace <TRANSACTION_ID> with the ID from Step 1
curl -X GET http://localhost:3000/api/bancard/status/<TRANSACTION_ID>
```

---

## 3. Simulate Bancard Webhook (Update Status)

This endpoint mimics Bancard calling your server to confirm payment. It requires a security token.

**Token Logic:** `MD5(private_key + shop_process_id + "confirm" + amount + currency)`
*   Default `private_key` in `.env`: `your_private_key`
*   `shop_process_id`: The Transaction ID from Step 1.
*   `amount`: Must be formatted to 2 decimal places (e.g., "10000.00").

**Test Command (Linux/Mac):**
This creates the token automatically and sends the request.

```bash
# 1. Export the Transaction ID (Replace with actual ID)
export TX_ID="<TRANSACTION_ID>" 

# 2. Generate Token (Assumes default private key 'your_private_key')
export TOKEN=$(echo -n "your_private_key${TX_ID}confirm10000.00PYG" | md5sum | cut -d ' ' -f 1)

# 3. Send Request
curl -X POST http://localhost:3000/api/bancard/update \
  -H "Content-Type: application/json" \
  -d '{
    "operation": {
        "shop_process_id": "'"$TX_ID"'",
        "amount": "10000.00",
        "currency": "PYG",
        "token": "'"$TOKEN"'",
        "response_code": "00",
        "response_description": "Approved"
    }
  }'
```

---

## 4. Refund / Rollback

Refund the transaction using the same Transaction ID.

```bash
# Replace <TRANSACTION_ID> with the ID from Step 1
curl -X POST http://localhost:3000/api/bancard/refund/<TRANSACTION_ID> \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10000,
    "description": "Refund for test",
    "metadata": { "reason": "requested_by_user" }
  }'
```
