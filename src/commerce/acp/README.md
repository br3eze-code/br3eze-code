# Agentic Commerce Protocol alignment

This directory is the protocol boundary for AgentOS commerce. It is intentionally separate from the commerce domain engine and all provider adapters.

## Reviewed target

The reviewed ACP stable snapshot is `2026-04-17`. The public ACP repository describes that snapshot as adding cart, feed, orders, authentication and MCP alongside the checkout API. ACP remains a beta open standard maintained by OpenAI and Stripe.

## Current mapping

| ACP concern | AgentOS implementation | Status |
|---|---|---|
| Product/feed data | `src/domains/commerce/shop.js` + `src/commerce/acp/index.js` | adapter started + frozen contract tests |
| Product availability | `products.stock` / `availability` | mapped |
| Product URLs | `/product/:id` | mapped |
| Cart | `carts` + commerce domain cart operations | existing + authenticated user-bound API boundary |
| Checkout | `shop.checkout()` + `executeCheckout()` | existing domain engine + request idempotency guard; not yet ACP HTTP compatible |
| Orders | `orders` + `/api/v1/shop/orders/*` | existing |
| Authentication | Firebase identity + tenant/domain scope | authenticated commerce context enforced for cart/checkout |
| Idempotency | `executeCheckout()` + durable SQLite/file store | request-level reserve/replay/conflict guard implemented; distributed atomic persistence still pending |
| Payment handlers | `PaymentGateway` | existing abstraction; ACP payment-handler mapping not implemented |
| Cancel/refund lifecycle | no complete external mutation surface found | **gap** |
| Fulfillment | `src/adapters/commerce/courier-gateway.js` + shipment/tracking | extracted adapter |
| ACP HTTP contract | none found during discovery | **gap** |

## Security boundary

User-facing cart and checkout routes must never treat a caller-supplied `channelId` as proof of ownership.

`src/api/routes/shop-context.js` resolves the commerce identity from authenticated Firebase state:

```text
Firebase identity
      ↓
   buyerId = uid
      ↓
 merchantId = tenantId
      ↓
 tenant/site/domain scope
      ↓
 channelId = authenticated uid
      ↓
 commerce domain operations
```

A caller may still identify the requested channel in the request for compatibility/diagnostics, but the public user-facing boundary canonicalizes the effective channel to the authenticated user. Agent, bot and POS workflows that need delegated channel identities require a separate authenticated service boundary rather than bypassing this rule with an arbitrary channel ID.

Checkout mutations also require an idempotency key. The same merchant/buyer/key/request is replayed, a key reused for a different request returns a conflict, and a failed checkout releases its reservation so a retry can proceed.

## Implementation rule

Do not make `shop.js` ACP-specific. The adapter must translate between protocol representations and the merchant domain. The merchant system remains authoritative for catalog, stock, orders, payments, fulfillment and customer records.

## Patch sequence

1. Freeze the internal-to-commerce data mapping and add contract tests. **Done.**
2. Add an authenticated commerce context so public cart/checkout routes cannot select another caller's channel. **Done.**
3. Add request-scoped idempotency reserve/replay/conflict behavior around checkout mutations. **Done at the host/store boundary; distributed atomic persistence remains.**
4. Extract commerce domain logic from `src/core` and isolate courier/channel integrations in adapters. **Done for the shop engine, shopping agent, courier gateway/providers and order notifier.**
5. Add authenticated ACP-facing HTTP routes matching the selected stable ACP snapshot. **Next.**
6. Map payment capabilities/handlers without storing or accepting raw payment credentials.
7. Add order retrieval plus cancellation/refund semantics where supported by the merchant system.
8. Add protocol conformance tests against the ACP OpenAPI/JSON Schema fixtures.
9. Only then treat the integration as an ACP implementation rather than an alignment layer.

This document deliberately avoids claiming that Br3eze is currently connected to ChatGPT Commerce or eligible for Instant Checkout.
