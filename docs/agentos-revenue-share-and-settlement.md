# AgentOS Revenue Share and Automated Settlement

## Commercial principle

AgentOS HQ owns the platform control plane, payment-provider relationship, pricing policy, escrow lifecycle, reconciliation, and audit trail. A white-label tenant partner operates inside its assigned commercial scope and receives a calculated partner share after the provider confirms payment and AgentOS claims the transaction idempotently.

The partner share is not calculated from Telegram input, an AI response, or a client-provided amount. It is calculated from an immutable pricing snapshot stored with the order.

## Calculation model

For each order or subscription invoice:

```text
Gross = quantity × server_side_unit_price
ProviderFee = fixed_provider_fee + (Gross × provider_rate)
Tax = tax_basis × tax_rate
RefundReserve = approved_refund_amount
ChargebackReserve = approved_chargeback_amount
PlatformFee = max(min_platform_fee, (Gross − ProviderFee) × platform_rate)
PartnerShare = Gross − ProviderFee − Tax − RefundReserve − ChargebackReserve − PlatformFee
NetSettlement = PartnerShare − prior_adjustments
```

The ledger stores all components in the transaction currency. It also records the pricing policy version, partner agreement version, and provider transaction reference so a later reconciliation can reproduce the calculation.

### Worked example

The following example assumes a KES 10,000 order, a 2.5% provider fee, a fixed KES 20 provider fee, a 5% AgentOS platform fee after provider fees, and no tax or reserves. The percentages are illustrative commercial assumptions.

| Ledger component | Calculation | Amount |
|---|---:|---:|
| Gross collection | 1 × KES 10,000 | KES 10,000.00 |
| Provider fee | KES 20 + 2.5% × KES 10,000 | KES 270.00 |
| Platform fee | 5% × (KES 10,000 − KES 270) | KES 486.50 |
| Partner share | KES 10,000 − KES 270 − KES 486.50 | KES 9,243.50 |
| AgentOS recognized revenue | Platform fee | KES 486.50 |

Tax, currency conversion, refunds, chargebacks, withholding, and payout fees must be added when applicable to the partner contract and provider integration.

## Automated settlement workflow

```text
Order created
    ↓
Pricing snapshot + tenant/partner ledger entry
    ↓
Provider payment initiated with idempotency key
    ↓
Authenticated webhook received
    ↓
Provider status verified
    ↓
Atomic claim: provider + transaction ID
    ↓
Escrow held and fees calculated
    ↓
Partner wallet credited once
    ↓
Notification + reconciliation record
```

AgentOS acknowledges an authenticated webhook quickly, then performs settlement through the injected escrow service. The settlement worker must claim `provider:transactionId` atomically before crediting a wallet. A duplicate webhook returns an acknowledged `alreadyProcessed` result and cannot create a second wallet credit.

## Ledger records

| Record | Required fields |
|---|---|
| Order | Order ID, tenant ID, partner ID, customer reference, immutable plan ID, quantity, currency |
| Pricing snapshot | Unit price, provider fee policy, platform fee policy, tax policy, agreement version |
| Provider payment | Provider, transaction ID, idempotency key, status, timestamps, raw reference without secrets |
| Settlement | Gross, provider fee, platform fee, tax, reserves, partner share, settlement state |
| Wallet entry | Partner ID, amount, currency, source settlement ID, balance before/after, idempotency key |
| Adjustment | Refund or chargeback reason, amount, reference, approval, resulting balance impact |

Keep the original transaction append-only. Refunds, chargebacks, and manual corrections are adjustment entries, not destructive edits to the gross payment.

## Controls

Only the AgentOS settlement service can release escrow or credit partner wallets. Partners may view their own ledger and settlement status but may not change platform fees, payment credentials, another partner’s records, or the settlement state. Admins can suspend a partner, pause settlement, or require manual review when reconciliation detects a mismatch.

The reconciliation job compares provider reports, webhook claims, escrow records, ledger entries, and wallet balances. Any mismatch produces a review item with a traceable settlement ID. Notifications show currency, gross amount, fees, and credited amount; they never include API keys, PINs, webhook signatures, or raw provider payloads.
