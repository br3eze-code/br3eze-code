# Zimbabwe payment production path

## Decision

Power Connect/AgentOS should treat payment providers as adapters behind the domain-neutral payment gateway. For a Zimbabwe-based merchant, Stripe Payments must not be used as a production rail because Zimbabwe is not currently a supported Stripe Payments merchant country.

## Recommended provider order

1. **Paynow** — multi-rail Zimbabwe gateway and the first integration to production-test.
2. **EcoCash** — direct local mobile-money rail where direct merchant/API approval is obtained.
3. **Smile&Pay** — bank-backed multi-rail gateway to evaluate as a second aggregator.
4. Other approved Zimbabwe gateways can be added as adapters without changing the billing core.

## Configuration

Set:

```env
MERCHANT_COUNTRY=ZW
```

The payment factory applies the merchant/provider policy before constructing the existing gateway. For `ZW`, Stripe credentials are removed from the effective configuration and Stripe is therefore not registered by the legacy gateway.

Do not put live payment credentials in source control. Merchant onboarding, KYC, settlement account details, webhook URLs, transaction limits, fees, and production approval remain provider-specific and must be completed with the provider.

## Architecture

```text
PaymentService
    -> PaymentGateway
        -> provider adapter
            -> provider webhook
                -> normalized payment event
                    -> ledger/billing
                        -> service fulfillment
```

The core should not assume Stripe, EcoCash, Paynow, or any other provider. Adding a provider should be an adapter/configuration change, not a rewrite of billing or voucher logic.

## Important merchant-model boundary

A customer paying Power Connect for connectivity is a merchant transaction. A transferable stored-value wallet or money-transfer service is a different regulatory model. Partner revenue share should therefore remain an accounting/settlement capability unless the required regulated payment/wallet structure has been approved.
