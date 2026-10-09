# Domain-neutral payment platform

The payment layer is provider-agnostic. Domains should depend on normalized payment contracts rather than provider SDKs or provider-specific HTTP calls.

## Canonical boundaries

- `src/payments/provider-adapter.js` — provider contract and normalized result shape.
- `src/payments/provider-registry.js` — merchant-country-aware capability registry.
- `src/payments/provider-catalog.js` — descriptive provider/rail catalog. It does not imply merchant approval or API access.
- `src/payments/payment-gateway.js` — existing gateway facade retained for compatibility.
- `src/payments/payment-service.js` — existing service/application boundary.
- `src/payments/webhook-handler.js` — existing webhook boundary.
- `src/payments/idempotency-store.js` — existing idempotency mechanism.

## Provider status

PesaPal has an existing provider implementation. Mastercard is currently a skeleton/template. Paynow, EcoCash, Smile&Pay, ContiPay, ZuriPay, OneMoney and Zimswitch are represented in the normalized catalog but must not be treated as implemented until their merchant-approved API credentials and exact integration contract are available.

This distinction is deliberate: the platform must never fabricate private endpoints, credentials, approval, settlement terms, or production availability.

## Required adapter lifecycle

`createPayment -> verifyPayment -> webhook verification -> normalized event -> ledger -> reconciliation -> refund/dispute where supported`.

Providers may expose only a subset. Capabilities must be declared explicitly and unsupported operations fail closed.

## Jurisdiction policy

Merchant eligibility is separate from credentials. A configured credential does not make a provider legal or available in a jurisdiction. Stripe is explicitly blocked for Zimbabwe (`ZW`) by the current merchant policy.

## Data/rates workbook

Rates, fees, settlement rules and merchant requirements should be maintained as sourced data with provider, country, currency, effective date and source fields. Do not hard-code volatile commercial rates into the payment kernel.
