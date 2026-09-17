# Payment domain — Phase A

Phase A establishes `PaymentPlatform` as the canonical payment boundary while retaining `PaymentGateway` only as a compatibility facade for unmigrated callers.

## Rules

- Provider implementations do not live in `payment-gateway.js`.
- Provider selection and capability discovery live in `PaymentPlatform`/`PaymentProviderRegistry`.
- Idempotency is owned by `PaymentPlatform` and backed by the existing durable store.
- Provider-specific transport, credentials, signatures and webhooks remain in adapters.
- Existing callers may use `PaymentGateway` temporarily; new code must use `createPaymentPlatform()`.
- `PaymentGateway` is deleted only after repository-wide caller and test migration.

## Exit criteria

1. No provider implementation remains in `payment-gateway.js`.
2. PaymentService uses `PaymentPlatform`.
3. Remaining PaymentGateway references are compatibility/test/documentation references only.
4. PaymentPlatform owns idempotency.
5. CI passes before the compatibility facade is removed.
