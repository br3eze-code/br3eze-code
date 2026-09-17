# Phase A exit state

- Provider implementations are removed from `payment-gateway.js`.
- `PaymentGateway` is compatibility-only.
- `PaymentService` delegates through `PaymentPlatform`.
- Payment idempotency is centralized in `PaymentPlatform`.
- Legacy gateway tests are replaced by canonical-platform tests.

Phase B will migrate remaining runtime callers, especially shop and webhook integrations, and then delete the compatibility facade.