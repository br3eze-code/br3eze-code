# Agentic Commerce Protocol alignment

This directory is the protocol boundary for AgentOS commerce. It is intentionally separate from `src/core/shop.js`.

## Reviewed target

The reviewed ACP stable snapshot is `2026-04-17`. The public ACP repository describes that snapshot as adding cart, feed, orders, authentication and MCP alongside the checkout API. ACP remains a beta open standard maintained by OpenAI and Stripe.

## Current mapping

| ACP concern | AgentOS implementation | Status |
|---|---|---|
| Product/feed data | `src/core/shop.js` + `src/commerce/acp/index.js` | adapter started |
| Product availability | `products.stock` / `availability` | mapped |
| Product URLs | `/product/:id` | mapped |
| Cart | `carts` + shop cart operations | existing |
| Checkout | `shop.checkout()` | existing, not yet ACP HTTP compatible |
| Orders | `orders` + `/api/v1/shop/orders/*` | existing |
| Authentication | Firebase identity + tenant/domain scope | existing; ACP boundary still needs formal auth mapping |
| Idempotency | transaction record currently uses an internally generated key | **gap: request-level idempotency is not wired yet** |
| Payment handlers | `PaymentGateway` | existing abstraction; ACP payment-handler mapping not implemented |
| Cancel/refund lifecycle | no complete external mutation surface found | **gap** |
| Fulfillment | courier gateway + shipment/tracking | existing |
| ACP HTTP contract | none found during discovery | **gap** |

## Implementation rule

Do not make `shop.js` ACP-specific. The adapter must translate between protocol representations and the existing merchant system. The merchant system remains authoritative for catalog, stock, orders, payments, fulfillment and customer records.

## Next patch sequence

1. Freeze the internal-to-commerce data mapping and add contract tests.
2. Add a request-scoped checkout-session layer instead of exposing the channel cart directly to an external agent.
3. Add real request idempotency persistence/replay semantics to checkout mutations.
4. Add authenticated ACP-facing HTTP routes matching the selected stable ACP snapshot.
5. Map payment capabilities/handlers without storing or accepting raw payment credentials.
6. Add order retrieval plus cancellation/refund semantics where supported by the merchant system.
7. Add protocol conformance tests against the ACP OpenAPI/JSON Schema fixtures.
8. Only then treat the integration as an ACP implementation rather than an alignment layer.

This document deliberately avoids claiming that Br3eze is currently connected to ChatGPT Commerce or eligible for Instant Checkout.
