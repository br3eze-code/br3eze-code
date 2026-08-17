# Current API Reference Debug Report

## Scope

This report compares `/home/ubuntu/upload/API_REFERENCE.md` with the current `upgrade/commerce-domains` working tree and focused regression behavior. It records observed facts only; route-string scans are treated as compatibility evidence rather than a substitute for runtime API testing.

## Confirmed state

The repository is on `upgrade/commerce-domains` at commit `754045069e017b39907bd70f180cd822a23cd638`, with uncommitted Phase 5 and domain-kernel changes. Dependencies are restored and `jest`, `eslint`, `pg`, `firebase-admin`, and `express` resolve successfully.

The six AgentOS boundary suites passed: domain kernel, health orchestrator, Telegram health ingress, onboarding session registry, Br3eze service agent, and device adapter. They produced 24 passing tests.

## Failures reproduced

The focused API regression command ran six suites. Four suites passed with 25 tests passing. Two suites failed to start because Jest executed an ESM test under a CommonJS transform path and rejected `import.meta` with `SyntaxError: Cannot use 'import.meta' outside a module`. The affected suite was `tests/unit/gateway-proposals.test.js`; the second failure is the corresponding Jest/configuration failure reported in the same run. This is a test-runner/module-mode problem, not evidence that the gateway route itself is correct or incorrect.

The payment webhook test logs an expected negative-path error for an unsupported `bogus` provider while its assertions pass. This is noisy test logging rather than a failing assertion.

## API compatibility gaps

`API_REFERENCE.md` defines Firebase-authenticated customer/admin routes, AI chat and skill execution, system/legal routes, payment webhooks, and network operations. The repository contains separate route families and gateway mounts, including `/api/v1/shop`, `/api/v1/project-manager`, `/api/v1/mesh`, `/api/v1/ask`, `/api/v1/tools`, `/api/v1/vouchers`, and `/api/v1/nodes`, but the literal API reference paths such as `/shop/products`, `/ai/chat`, `/ai/skills/execute`, `/system/legal/accept`, and `/webhooks/mpesa` were not found as exact route declarations under `server` or `src`.

This indicates that the reference is not a verified runtime contract for the current codebase. Some discrepancies may be caused by mount prefixes or different route versions, but the current evidence is insufficient to certify compatibility. A route-by-route contract test is required.

## Security and architecture risks

The API reference uses Firebase as the authentication mechanism, but it does not specify tenant membership, site scope, roaming-principal resolution, router ownership, idempotency, audit correlation, or AgentOS Work/Loop/Action/Evidence requirements. The current health and onboarding modules enforce these controls internally, but the API reference routes do not yet demonstrate that every external entrypoint propagates the same authority context.

The `/ai/skills/execute` shape accepts a free-form `skill`, `action`, and `params`. It must be treated as an intent proposal that creates governed Work and Action records, not as a direct command or CLI bypass. Payment webhooks require provider signature verification and idempotency; Firebase bearer authentication alone is not sufficient for provider callbacks.

## Remediation priority

The immediate fix is to establish one Jest ESM configuration path for all ESM suites and add route contract tests against the actual mounted gateway. Next, add an authentication-to-authority middleware contract that resolves Firebase identity into principal, tenant, site, and capability context. Then route AI skill execution through AgentOS Work/Loop/Action/Evidence and require provider-specific webhook verification and idempotency. Only after these tests pass should API_REFERENCE.md be promoted to a versioned compatibility contract.
