# AgentOS Partner Node Migration Guide

## Purpose

This guide describes how to migrate an existing white-label partner node to the AgentOS local gRPC proxy and SQLite fallback infrastructure. The migration is designed for partner deployments that may operate on Linux, Windows, desktop Electron, Cordova/mobile, or a site-local gateway.

> The migration must preserve tenant isolation, payment idempotency, device authorization, database parity, and a tested rollback path.

## Target state

The target node uses the AgentOS local proxy for site-local device and terminal operations. The proxy loads gRPC dependencies lazily, scopes clients to approved endpoints, uses TLS by default, and requires explicit confirmation for mutations. AgentOS uses SQLite as a durable local fallback when the remote database is unavailable, while retaining normalized object parity with remote and in-memory adapters.

| Layer | Target responsibility | Migration concern |
|---|---|---|
| Telegram/desktop/mobile | Present scoped actions and status | Preserve callback authorization and short-lived state |
| AgentOS gateway | Enforce tenant, partner, site, and role policy | Inject services; do not use globals |
| Local gRPC proxy | Connect to local terminals or devices | Lazy-load runtime; allow-list endpoints; TLS by default |
| SQLite fallback | Persist users, wallets, vouchers, transactions, and audit records | Migrate schema safely and compare normalized rows |
| Payment/escrow | Verify provider status and credit ledgers once | Use provider transaction idempotency keys |

## Phase 0 — Inventory and change freeze

Before installation, record the partner ID, node ID, operating system, current connector version, terminal endpoint, certificate location, database path, schema version, feature flags, and rollback owner. Export an encrypted SQLite backup and preserve the current connector package. Freeze schema changes during the cutover window.

The inventory should also capture active Telegram bots, partner administrators, assigned sites, wallet balances, pending vouchers, unsettled payments, webhook retry queues, and any active device mutations. Reconcile pending payments before migrating so the cutover does not create an ambiguous escrow state.

## Phase 1 — Install the local proxy in parallel

Install the AgentOS proxy beside the existing connector. Do not remove the old connector yet. Configure the protobuf path, local endpoint allow-list, gRPC request timeout, certificate chain, and maximum cached clients. For development-only isolated networks, insecure mode may be explicitly enabled; production nodes must use TLS and must not expose RouterOS, gRPC, Winbox, SSH, or HTTP management ports publicly.

The proxy should be injected into the Starlink or device adapter. It should not be imported by browser-only code unless the local transport is actually invoked. This keeps Electron, Cordova, and PWA builds compatible.

Run the following read-only checks before enabling writes:

| Check | Expected result |
|---|---|
| Endpoint identity | The returned terminal/site identity matches the assigned node |
| Health | Device is reachable and status is normalized |
| Telemetry | Throughput, latency, uptime, and alerts are available or explicitly unavailable |
| Authorization | A user outside the assigned partner/site scope is rejected |
| Audit | The request is logged without secrets or raw credentials |
| Timeout | An unreachable endpoint fails within the configured deadline |

## Phase 2 — Prepare SQLite fallback

Back up the current database and calculate a schema fingerprint. Apply safe migrations using `PRAGMA table_info` checks before adding columns. Verify that users, vouchers, plans, wallets, transactions, audit records, and webhook idempotency records have equivalent keys and JSON serialization behavior.

Use the declared wallet key consistently, such as `wallets.uid`. Serialize JSON values through the existing database helper and deserialize individual fields or full rows through the database helper. Do not parse a complete SQLite row as if it were one JSON document.

The native `better-sqlite3` binding must load in the target runtime. If native loading fails, AgentOS must expose fallback mode in diagnostics; it must not silently claim that native SQLite parity was verified.

## Phase 3 — Shadow reads and parity fixtures

Run a deterministic fixture through the remote, native SQLite, and in-memory adapters. Compare normalized objects rather than raw rows. The comparison should include user IDs, voucher codes and redemption state, wallet balances, plan IDs, transaction metadata, timestamps, and settlement status.

For read-only production traffic, issue a primary read and a shadow read against the new implementation. Do not duplicate mutations. Log field-level differences with partner and node IDs while redacting passwords, PINs, API keys, tokens, and customer secrets.

A parity failure blocks cutover until the difference is understood. Acceptable differences include serialization format, timestamp precision, and adapter-specific transport metadata; business fields must match.

## Phase 4 — Feature-flagged cutover

Enable the local proxy and SQLite fallback behind a partner/node feature flag. Keep the prior connector and database backup available during the rollback window. Start with read-only health, telemetry, inventory, voucher lookup, and wallet display.

Enable mutations only after read-only checks pass. Reboot, stow, device configuration, payment initiation, escrow release, and wallet credit require explicit role authorization and confirmation. AI agents may create a change request but must not bypass the policy layer.

## Phase 5 — Payment and webhook verification

Before accepting production traffic, verify that the webhook router has an injected database, payment provider, escrow service, and notification service. Authenticate callbacks before acknowledging or processing them. Record the provider transaction ID with a unique idempotency key before any wallet credit or escrow release.

A repeated provider callback must return an acknowledged already-processed result and must not create another wallet credit. Reconciliation logs must redact payload secrets and use the configured currency rather than hard-coded regional assumptions.

## Phase 6 — Observe and reconcile

Monitor local proxy latency, gRPC errors, timeout rates, SQLite lock errors, fallback frequency, webhook retries, idempotency conflicts, wallet balances, and shadow-read differences. Record the Node.js version, native addon version, schema version, and database file used by every migration test.

Close the migration only after the partner confirms device operations, customer workflows, wallet views, and payment receipts. Preserve audit logs and the old connector until the rollback window expires.

## Rollback procedure

Disable the feature flag and stop new proxy mutations. Keep audit events and payment idempotency records. Restore the previous connector only after confirming that no in-flight device mutation or settlement job is active. Restore the encrypted SQLite backup only when data integrity requires it; otherwise preserve the new database and reconcile differences through append-only adjustments.

Never delete the prior database, credentials, certificates, or connector during the rollback window. After rollback, run payment reconciliation and confirm that no partner wallet was credited twice.

## Acceptance checklist

| Area | Acceptance condition |
|---|---|
| Proxy | Lazy runtime loading, TLS production path, endpoint allow-list, timeout, and client scoping pass |
| Authorization | Tenant, partner, region, site, and role boundaries are enforced at action time |
| SQLite | Native binding is loaded; schema migration is safe; normalized native/fallback fixtures match |
| Payments | Signature/authentication, provider verification, idempotency, escrow, and wallet credit pass |
| Telegram | Callback IDs are opaque; state expires; prices are server-side; confirmations are enforced |
| Operations | Health, telemetry, logs, alerts, rollback, and reconciliation are documented |

## Implementation references

The reusable workflow is captured in the AgentOS `agentos-port-and-fallback-audit` skill. The local proxy implementation is `src/services/starlink/local-grpc-proxy.mjs`; SQL fallback behavior is implemented in `src/core/sqlite-db.js` and `src/core/database.js`; partner settlement uses `src/services/partner/ecocash-escrow.mjs` and the injected webhook router.
