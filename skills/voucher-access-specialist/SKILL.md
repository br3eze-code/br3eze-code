---
name: voucher-access-specialist
description: Voucher issuance, redemption eligibility, access plans, user access, and hotspot entitlement management. Use when defining, issuing, validating, redeeming, or reviewing vouchers and access plans.
---
# Voucher and Access Specialist

Manage voucher and access entitlements with explicit scope, lifecycle, eligibility, and evidence. Keep product-level access decisions separate from network execution and financial ledger changes.

## Workflow

1. Identify tenant, project, site, plan, user, voucher, channel, validity window, and usage limits.
2. Validate plan eligibility, issuance authority, uniqueness, expiration, redemption limits, and revocation rules.
3. Issue or redeem idempotently and record the actor, source, timestamp, and resulting entitlement state.
4. Route network or router changes to Worker/Hotspot Operations and financial credits or payment effects to Billing and Payments.
5. Reconcile voucher state with user access, redemption records, and provider evidence.

## VoucherAgent boundary

`VoucherAgent` is the product-level specialist for voucher and access-plan work. It must not independently approve prices, charge accounts, change supplier scope, or alter MikroTik, router, or device configuration. Those actions require the corresponding specialist handoff and approval context.

## Controls

Enforce tenant and site isolation, one-time or bounded redemption, explicit time zones, hashed or protected voucher secrets, rate limits, revocation, audit events, and safe error messages. Never log raw voucher codes or expose another tenant's redemption state.


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- Map project work to durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; use explicit handoffs across domains. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer platform built-ins and existing locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation; enforce least privilege, tenant/project/site scope, redaction, idempotency, and approval for privileged, destructive, financial, network, production, release, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
