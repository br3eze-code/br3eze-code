# Br3eze Africa live-site audit and AgentOS port plan

Date: 2026-10-22
Target: canonical `main` in `br3eze-code/br3eze-code`

## Scope and evidence

This audit connects issues observed on the published `br3eze.africa` site with the repository that owns the website and AgentOS implementation. A readable page inspection does not prove that payment, authentication, tenant isolation, or router operations work end to end; those require integration tests and deployment verification.

## Patches applied directly to main

- `package.json`: removed an unresolved merge conflict, retained the existing package configuration, and restored `test:production` as `npm test -- --runInBand --coverage=false`.
- `src/core/ToolRegistry.js`: reduced the PascalCase module to a compatibility facade over the canonical `src/core/tool-registry.js` implementation. Kept the historical default singleton and named error/class exports, including `CapabilityBoundaryError`.
- `src/core/agent-runtime/index.js`: resolved merge markers and retained the evaluation, trajectory replay, declarative workflow, framework adapter, and usage exports/capability declarations.
- `src/core/firebase-auth.js`: removed the competing identity implementations. Token verification now goes through the registered identity provider; profile roles and tenant/site metadata are resolved server-side, without importing a Firebase SDK into this adapter.
- `src/core/product-query-service-bridge.js`: removed conflict markers and kept the registered `document-store` provider path rather than introducing a second persistence-provider lookup.

These commits are incremental repairs, not proof that the whole repository or production site is healthy.

## Remaining high-priority work

### P0 — Restore a buildable canonical runtime

The following files were observed with unresolved Git conflict markers and must be reconciled individually before CI can be called green:

- `src/core/agentRuntime.js` — competing runtime implementations; decide and document one execution owner before deleting either path.
- `scripts/core-boundary-gate.mjs` — conflict-damaged architecture gate.
- `src/core/node-registry.js` — competing registry implementations.
- `src/core/orchestrator.js` — competing orchestration implementations.
- `src/core/skills/SkillRegistry.js` — competing skill loading/registry implementations.
- `src/services/vouchers.js` — competing voucher service implementations.
- `src/core/specialists/SpecialistToolRegistry.js` — decide whether this is a specialist ownership index or an execution registry; it must not become a second global tool executor.

Search the full repository for `<<<<<<<`, `=======`, and `>>>>>>>`; this list is not guaranteed exhaustive. Do not mechanically choose one side for every conflict. Compare imports, tests, callers, and behavior, then port missing behavior into the canonical owner.

### P0 — Production checks

- Run `npm run test:production`, `npm run build`, type checks, architecture gates, PHP route/billing smoke tests, and security checks under Node.js 22.
- Validate root and server lockfiles with deterministic `npm ci`; do not update dependency versions casually to mask a failed install.
- Inspect GitHub Actions logs and rerun after fixes. A queued run or a commit being pushed is not evidence of success.
- Verify the deployed artifact and key public routes after a successful deployment.

### P0 — Website routes and user journeys

- Investigate the published `status.html` link returning 404. `www/status.html` exists in the repository, so verify the actual hosting target, deploy artifact, path/case and rewrite rules before changing the page link.
- Check that `home.html`, login/account creation, dashboard, shop/checkout, terms and privacy are mutually consistent and responsive.
- Confirm every displayed CTA lands on a working route and every form reports success/failure honestly.

### P0 — Payments and balances

- Verify server-side provider callbacks/signatures, amount/currency matching, idempotency, duplicate callbacks, failure/cancel paths, refunds and reconciliation.
- Never credit a wallet from client-side success state alone.
- Keep each payment provider behind an adapter; the domain service must own transaction state.

### P0 — Tenant boundaries and network provisioning

- Test cross-tenant denial for users, sites, sessions, vouchers, orders, balances and router credentials.
- Enforce partner/site approval on the server, not only in the UI.
- Redact router credentials from URLs, logs, errors and client responses.
- Verify voucher issuance, redemption and expiry against the actual router/session state.

### P1 — Legal and product claims

- Reconcile the legal entity, jurisdictions, supported countries/currencies, payment providers and data-retention/security claims with deployed behavior.
- Hide or label features that are not implemented. Do not advertise a provider merely because a UI option exists.
- Keep the homepage focused on the primary customer journey, with distinct paths for Wi-Fi users, network partners and enterprise deployments.

## Acceptance criteria

A fix is complete only when:
1. The changed files contain no conflict markers and parse/compile.
2. Relevant unit and integration tests pass.
3. Authorization and tenant-isolation tests pass for affected workflows.
4. CI and deployment workflows complete successfully.
5. The deployed route or transaction is verified against the intended artifact.

Current status: **partial repair in progress; do not treat the site or repository as production-verified yet.**
