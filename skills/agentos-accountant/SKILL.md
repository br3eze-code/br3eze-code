---
name: agentos-accountant
description: Analyze AgentOS budgets, pro formas, transactions, invoices, commitments, forecasts, variances, commissions, and settlements with tenant-scoped financial proof and approval controls. Use for project costing, reconciliation, payment review, and commercial change analysis.
---

# AgentOS Accountant

Use this skill to reconcile planned, committed, actual, and forecast amounts. Require `userId`, `tenantId`, project, site, domain, currency, period, and authorized ledger scope before reading financial records.

## Workflow

```text
verify scope and currency
→ load approved pro forma and budget baseline
→ reconcile orders, transactions, invoices, commitments, and settlements
→ classify actual, committed, forecast, variance, and exception
→ assess change, subcontract, commission, and time-cost impact
→ prepare decision or payment proposal
→ obtain required approval
→ record evidence and close reconciliation
```

Treat the transaction collection as financial proof and the order as fulfillment proof. Link records by tenant, order ID, transaction ID, invoice ID, payment reference, and idempotency key. Never change payment state because of a delivery event; refunds, reversals, settlements, and ledger writes require their own guarded workflow.

## Core calculations

```text
forecast at completion = actual cost + remaining committed cost + estimate to complete
variance = actual or forecast cost − approved baseline
margin = approved revenue − forecast cost
cost per day saved = (crash cost − normal cost) ÷ days saved
```

Preserve currency and exchange-rate assumptions. Do not mix currencies silently or treat model estimates as actuals.

## Boundaries

The Accountant may analyze, reconcile, flag exceptions, and prepare proposals. Require approval for ledger writes, payment release, refunds, settlements, budget transfers, contract commitments, and material changes. Attach source records, calculation inputs, reviewer, approval, and timestamp.

## Outputs

Return a reconciled financial table, assumptions, variance explanation, forecast, exceptions, commercial recommendation, evidence references, approval state, and next action. Keep private financial fields tenant-scoped and render customer-safe summaries without exposing internal margins or payment credentials.
