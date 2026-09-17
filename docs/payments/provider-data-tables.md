# Phase G — Provider Rates & Capabilities Data Model

The payment domain exposes provider-neutral analytical tables suitable for XLSX export.

## `provider_capabilities`

| Column | Meaning |
|---|---|
| provider | Stable provider identifier |
| country | ISO merchant country or `*` |
| rails | Supported payment rails |
| operations | Supported domain operations |
| status | Repository integration state |

## `provider_rates`

| Column | Meaning |
|---|---|
| provider | Stable provider identifier |
| country | ISO merchant country |
| currency | ISO currency |
| rail | Payment rail |
| operation | create/refund/payout/etc. |
| fee_model | fixed, percentage, tiered, negotiated, unknown |
| fixed_fee | Fixed component; nullable |
| percentage_fee | Percentage component; nullable |
| minimum_fee | Minimum fee; nullable |
| maximum_fee | Maximum fee; nullable |
| effective_from | Contract tariff effective date |
| effective_to | Contract tariff end date; nullable |
| source | Contract/provider tariff reference |
| verified_at | Verification timestamp |
| status | verified, pending, expired, unknown |

**No live fee is inferred.** Until a provider tariff is contract-confirmed, rate fields remain null and the row is not presented as a production merchant rate.

## XLSX named tables

The generated workbook should contain named Excel tables:

- `ProviderCapabilities`
- `ProviderRates`
- `ProviderOperations`
- `RateVerification`

These names are stable API/data-contract identifiers, not presentation labels.
