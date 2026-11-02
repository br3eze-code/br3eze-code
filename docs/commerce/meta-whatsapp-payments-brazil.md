# Meta / WhatsApp payments in Brazil — architecture and Br3eze adoption

## Executive finding

Meta Pay is not a generic merchant gateway that Br3eze can inherit as a provider. The relevant model is **WhatsApp commerce with native payment experiences in Brazil**. Meta's April 2023 announcement describes product discovery, catalogue browsing, cart creation and payment inside a WhatsApp conversation. The initial small-business flow accepted participating Mastercard and Visa debit, credit and prepaid cards through supported payment partners such as Cielo, Mercado Pago and Rede. Meta's June 2024 announcement extended in-chat payments to medium and large businesses using the WhatsApp Business Platform and described a more structured PIX option.

Official references:
- Meta, *Pay Small Businesses in Brazil on WhatsApp* (2023): https://about.fb.com/news/2023/04/pay-small-businesses-in-brazil-on-whatsapp/
- Meta, *New AI tools, Meta Verified and more for businesses on WhatsApp* (2024): https://about.fb.com/news/2024/06/new-ai-tools-meta-verified-and-more-for-businesses-on-whatsapp/
- Meta Pay country availability: https://www.meta.com/meta-pay/availability/
- WhatsApp Pay Brazil implementation notes from messaging providers: https://docs.cm.com/messaging/whatsapp/payments-brazil and https://docs.360dialog.com/docs/messaging/payments/payments-api-brazil-only

Meta's availability page currently lists Brazil with Facebook and WhatsApp payment surfaces; Zimbabwe is not listed. The Brazil-specific native payment API documentation from messaging providers says the WhatsApp Business Account must be Brazilian, a Meta catalogue must be linked, and the recipient must have a Brazilian phone number. Treat those as hard feature gates for the Brazil-native flow, not as a workaround for a Zimbabwe merchant.

## Product boundary

Keep three concepts separate:

1. **Commerce domain** — product catalogue, inventory, cart, order, invoice and fulfillment state. Br3eze already has a shop engine in `src/core/shop.js` and server order tracking in `server/src/domains/commerce/order-tracking.js`.
2. **Payment platform** — merchant payment creation, verification, provider webhooks, idempotency, transaction records and reconciliation. Br3eze already has the provider-neutral boundary in `src/payments/payment-platform.js`.
3. **Messaging/channel adapter** — renders the catalogue and order lifecycle inside WhatsApp and transports customer messages. It must not own payment truth or create a parallel order database.

**Meta Pay / WhatsApp native payments are not to be registered as a payment provider adapter.** Meta's in-chat experience is a channel checkout surface backed by participating payment partners. The actual payment processor/partner remains responsible for payment acceptance and settlement.

## Br3eze architecture

```text
WhatsApp customer
   |
   v
WhatsApp channel adapter
   |  identity + tenant/site scope
   v
Commerce domain (existing shop owner)
   |  catalogue -> cart -> checkout -> order
   v
PaymentPlatform (existing payment owner)
   |  merchant-country policy + provider capability
   v
Approved payment partner / rail
   |  signed provider event + status verification
   v
Payment event -> transaction ledger -> reconciliation
   |
   v
Order payment state (separate from fulfillment state)
   |
   +--> WhatsApp order status message
   +--> Resend email
   +--> authenticated order tracking page/API
```

Do not duplicate the shop engine in the WhatsApp adapter. The adapter should translate WhatsApp message payloads into existing commerce commands and format domain results back into WhatsApp messages.

## Brazil-native WhatsApp flow

The documented customer journey is:

1. Customer discovers the business and browses the linked Meta product catalogue.
2. Customer selects products and sends a cart.
3. Business sends an order summary/payment request using the supported WhatsApp Business Platform payment message format.
4. Customer selects an available method such as PIX, boleto, payment link or saved card, depending on the approved provider and account configuration.
5. The payment partner processes the transaction.
6. Br3eze accepts payment state only after the trusted provider confirmation / server-side verification.
7. Br3eze sends an order-status update and continues fulfillment tracking.

The messaging-provider implementation notes identify `order_details` and `order_status` as the message types used for the payment summary and subsequent order lifecycle. The exact message schema, supported payment options and eligibility must be validated against the selected BSP/Meta API version before enabling production traffic.

## Zimbabwe deployment and fallback

For a Zimbabwe merchant (`MERCHANT_COUNTRY=ZW`):

- Do not expose Brazil-native WhatsApp payment messages or claim Meta Pay is available to the merchant.
- Continue to use only payment providers approved for the merchant's Zimbabwe entity, settlement account, currency and production environment.
- WhatsApp can still be used as a **commerce and notification channel**: product links, cart summaries, secure hosted checkout links, order confirmations and tracking updates.
- The hosted checkout must be created by the configured Br3eze payment provider. WhatsApp must never collect card details or treat a message delivery/read receipt as payment proof.
- A Brazil-based merchant deployment can be separately enabled only after its Brazilian legal entity, Brazilian WABA, catalogue linkage, customer-region requirements, provider contract, credentials, settlement and production approval have all been verified.

The Brazil flow is not a shortcut around Zimbabwe merchant onboarding or payment-provider eligibility.

## Payment and order state invariants

Financial state and fulfillment state are separate:

- Financial: `pending`, `succeeded/paid`, `failed`, `cancelled`, `refunded`, `reversed`, `settled`.
- Fulfillment: `unfulfilled`, `processing`, `ready_for_dispatch`, `dispatched`, `in_transit`, `delivered`, and explicit exception states.

Rules:

- Creating an order is not payment settlement.
- Selecting `card` is not proof of a card payment.
- Selecting `cash` / cash-on-delivery is not proof that cash has been collected.
- Only an atomic internal debit (for example, Br3eze account credits) or a verified provider collection event may mark an order paid.
- A courier delivery event must never mark a payment paid; a payment event must never mark a parcel delivered.
- Use provider event IDs and stable idempotency keys to make duplicate callbacks safe.
- Verify webhook signatures and, where supported, query the provider's transaction status before fulfilling high-value or ambiguous payments.
- Preserve original provider event, provider transaction ID, amount, currency, merchant, tenant, order and invoice references for reconciliation.
- Never infer settlement from browser redirects, WhatsApp message status, screenshots, or customer-supplied claims.

The shop checkout currently creates a financial transaction record and an order record. The checkout settlement rule has been hardened so only the account-credit debit performed inside the checkout transaction is immediately settled; card and cash orders remain pending until trusted collection confirmation.

## Notifications and order tracking

Existing Br3eze capabilities to reuse:

- `src/adapters/commerce/order-notifier.js` — new-order notification fan-out to configured Telegram/WhatsApp operations channels and the notification port.
- `server/src/domains/commerce/order-tracking.js` — authenticated tenant-scoped tracking reads and logistics refresh.
- Resend email — already used by the order-tracking server route, configured with server-only `RESEND_API_KEY` and a verified sender domain.

Next integration work should add a **WhatsApp Business Cloud API adapter** behind the existing channel/notification boundary, rather than treating the Baileys socket as the Cloud API implementation. It should support template/session policy, delivery receipts, inbound webhook verification, retries, opt-out and tenant-scoped recipient identity. Order updates should be generated from persisted order/payment events, not directly from raw inbound message text.

## Explicit gaps before production

- No verified Meta/WhatsApp native-payment merchant integration or Cloud API `order_details` / `order_status` sender was found in the current repository.
- Existing WhatsApp channel notification code uses a channel socket abstraction; this is not evidence of a production WhatsApp Business Cloud API payment integration.
- The selected payment partner's API contract, webhook signature, refund semantics, settlement currencies and merchant-country eligibility must be documented and tested before enabling it.
- The payment event pipeline must be proven to update the authoritative commerce order exactly once, with amount/currency/order/tenant matching, before automatic fulfillment is allowed.
- Brazil support requires a separately configured and verified Brazil merchant deployment; it must not be enabled by changing a country string alone.

## Acceptance gates

1. Catalogue/cart/order operations still have one domain owner and persist to the existing commerce store.
2. Channel identity is authenticated and mapped to a tenant; user-supplied channel IDs cannot impersonate another customer.
3. Payment provider eligibility is checked by merchant country and configured capabilities.
4. Checkout creation is idempotent and never implies settlement by payment-method label.
5. Invalid webhook signatures are rejected; duplicate valid events are harmless.
6. Amount, currency, order, invoice and tenant references are cross-checked before the order is marked paid.
7. Refunds/reversals update financial state without rewriting fulfillment history.
8. WhatsApp and Resend notification failures do not roll back a committed payment or order.
9. Brazil-native message types are disabled unless the full Brazil eligibility gate is satisfied.
10. Automated tests cover success, failure, duplicate callback, mismatched amount/currency, invalid signature, delayed event, refund and notification outage.
