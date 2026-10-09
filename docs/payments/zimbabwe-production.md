# Zimbabwe payment production path

## Decision

AgentOS treats payment providers as adapters behind the domain-neutral `PaymentPlatform`. A Zimbabwe merchant must only use production providers/rails for which the merchant has completed the required onboarding, KYC, credentials, settlement setup and production approval.

Stripe remains subject to its current merchant-country eligibility rules and must not be treated as a Zimbabwe production rail unless eligibility changes and the merchant is approved.

## Provider selection

Use the provider registry and capability catalog to select an available gateway/rail. Do not hard-code provider names in commerce, billing, voucher or connectivity domains.

Provider status must distinguish at minimum:

- `implemented`
- `configured`
- `contract-required`
- `sandbox-only`
- `discontinued`
- `unavailable`

## Configuration

Set:

```env
MERCHANT_COUNTRY=ZW
```

Provider credentials belong only in deployment/runtime secrets. Merchant onboarding, KYC, settlement account details, webhook URLs, transaction limits, fees and production approval remain provider-specific.

## Architecture

```text
Domain
  -> PaymentPlatform
      -> ProviderRegistry
          -> ProviderAdapter
              -> Payment Rail / Method
                  -> normalized payment event
                      -> ledger / reconciliation
                          -> domain fulfillment
```

The payment core must not assume Stripe, EcoCash, Paynow, Wi-Fi, Starlink, vouchers or any other business domain. Adding or changing a provider is an adapter/configuration change.

## Merchant-model boundary

A customer payment for goods or services is a merchant transaction. Transferable stored value, wallet issuance, money transfer and partner revenue sharing can have different regulatory and accounting requirements. Keep those concerns outside the payment transport adapters unless the required legal and provider arrangements are in place.
