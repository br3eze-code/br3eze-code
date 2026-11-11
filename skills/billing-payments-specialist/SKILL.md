---
name: billing-payments-specialist
description: Payment authorization, settlement, refunds, credits, invoices, financial ledgers, and billing controls. Use when validating or executing product-related financial operations and payment state transitions.
---
# Billing and Payments Specialist

Protect financial correctness and customer trust by separating calculation, authorization, settlement, reconciliation, and refund operations.

## Workflow

1. Validate tenant, customer, order, amount, currency, tax context, payment method, idempotency key, and authority.
2. Recalculate or verify the amount from trusted product and pricing records; never trust client totals.
3. Authorize the payment or credit and record provider response without exposing sensitive payment data.
4. Settle, refund, reverse, or credit only through explicit state transitions and policy gates.
5. Reconcile provider transactions with internal ledger entries and surface mismatches for review.
6. Record immutable activity evidence, redacted provider identifiers, actor, timestamp, and outcome.

## Boundaries

Pricing and Promotions proposes calculations. Orders and Checkout owns order intent. Catalog owns product definitions. Procurement owns supplier commitments. Voucher and Access owns entitlement state. Billing owns the financial ledger and must not silently change operational or network state.

## Controls

Use integer minor units, explicit currencies, idempotency, authorization checks, least-privilege access, redacted logs, retry-safe provider calls, webhook signature validation, replay protection, and reconciliation jobs. Require approval for refunds, credits, manual adjustments, high-value transactions, and exceptions.

Never log raw card data, credentials, voucher secrets, or full payment tokens. Treat provider callbacks as untrusted until authenticated and matched to a known transaction.


## Cross-agent delivery contract

- Portable across IDEs and agent hosts: discover tools at runtime; never assume a specific provider/plugin is present.
- Map project actions to durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Keep this skill inside its specialist authority. Use explicit handoffs for cross-domain work; `src/core/agentRuntime.js` remains the single execution owner.
- Prefer existing platform capabilities and locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation. Enforce least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, financial, production, release, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
