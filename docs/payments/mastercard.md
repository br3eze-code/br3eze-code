# Mastercard A2A — Provider Implementation Guide

Status: skeleton provider added (src/payments/providers/mastercard.js) — this is a template you must complete to enable live Mastercard A2A flows.

Overview
- AgentOS supports a payment gateway abstraction (src/payments/payment-gateway.js and src/payments/payment-service.js). To enable Mastercard A2A (Account-to-Account) you need a provider implementation that implements the gateway-provider interface used by PaymentGateway.

Required capabilities
- OAuth 1.0a RSA-SHA256 request signing for Mastercard A2A
- Certificate / private key handling (P12 or PEM) with secure storage (e.g., ./certs/ with restricted perms)
- Webhook verification endpoint (/api/webhook/mastercard) that verifies Mastercard webhook signatures
- Idempotent transaction handling and webhook reconciliation

Suggested env vars
```env
MC_CONSUMER_KEY=your_consumer_key
MC_PRIVATE_KEY_PATH=./certs/mastercard-key.p12    # or .pem
MC_ENVIRONMENT=sandbox|production
MC_MERCHANT_ID=your_merchant_or_account_id
MC_WEBHOOK_SECRET=...
```

Implementation notes
1. Build a provider class that exposes these methods:  
   - createPayment(paymentData)  → creates payment intent/charge and returns { status, transactionId, redirectUrl?, providerData }  
   - verifyPayment(transactionId) → queries provider to return final status  
   - verifyWebhook(payload, headers) → returns true|false  
   - refund(transactionId, amount, reason) → processes refunds

2. Add the provider to src/payments/payment-gateway.js providers map (register a key like 'mastercard-a2a').

3. Add a webhook route to the gateway:  
   POST /api/webhook/mastercard  → verify signature + call gateway.handleWebhook('mastercard', payload, headers)

Security
- Keep the private key file out of the repo. Add cert paths to .gitignore.  
- Ensure your webhook endpoint validates signatures and rejects replayed requests (nonce + timestamp checks).

Testing
- Use Mastercard sandbox / mock endpoints and create integration tests that assert the full lifecycle: createPayment → simulated webhook → verify and voucher provisioning.

References
- Mastercard developer docs (sandbox & OAuth 1.0a RSA-SHA256) — follow their examples for request signing and webhooks implementation.

If you want, I can implement a fully working provider (including OAuth signing) against Mastercard sandbox — give me the exact sandbox endpoints and cert format you prefer and I’ll draft the code and tests.