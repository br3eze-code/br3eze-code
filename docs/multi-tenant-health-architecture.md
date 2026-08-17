# Multi-Tenant, Multi-Site, Multi-Router Health Architecture

## Operating model

A Telegram message is an ingress event, not an authorization decision and not a direct CLI intent. The channel adapter validates an explicit `/health` command, maps the Telegram user and chat to a server-side principal, deduplicates the update, and creates typed AgentOS Work. The Work enters the existing Loop engine, where policy, site membership, router enrollment, approval requirements, adapter execution, and Evidence verification are enforced.

```text
Telegram webhook or fallback poller
        ↓
verified update + idempotency key
        ↓
channel principal resolver
        ↓
typed Health Work
        ↓
AgentOS Loop / Action / Evidence
        ↓
site-scoped router adapter
        ↓
health evidence + notification
```

## Scope model

| Entity | Authority boundary |
|---|---|
| Tenant | Customer organization. Never inferred from Telegram chat ID, phone number, router IP, or user text. |
| Site | Operational location owned by exactly one tenant. Every router and site membership is tenant-scoped. |
| Principal | Person or service identity. A roaming principal may have memberships in several tenants and sites, but an unqualified cross-tenant health request is rejected as ambiguous. |
| Channel identity | Transport identity such as `telegram:<chat-id>`. It resolves to a principal and is never a tenant key. |
| Router | Enrolled device owned by one tenant/site and accessed through a protocol adapter. |
| Health Work | Immutable objective and acceptance criteria. The channel cannot rewrite acceptance criteria or invoke a privileged CLI path. |

## Capacity model

The system must not run one giant synchronous loop for 1,000 tenants. A durable queue partitions work by tenant and site. Each tenant has at most one active polling sweep by default, while the worker pool uses bounded concurrency across tenants. Router checks are capped per Work, and a tenant/site fairness policy prevents a large tenant from starving smaller tenants. Each health observation carries `tenantId`, `siteId`, `routerId`, `principalId`, `correlationId`, `workId`, and `loopId`.

The initial repository contract defaults to eight concurrent router checks and a maximum of fifty targets per request. Production values should be measured against adapter latency, provider rate limits, database connection capacity, and notification throughput before being increased.

## Telegram delivery

Telegram supports mutually exclusive `getUpdates` polling and webhooks.[1] The preferred path is a verified HTTPS webhook that performs minimal validation and enqueues the update. A durable worker performs principal resolution and AgentOS Work creation. If webhook delivery is unavailable, one controlled long-polling worker may be used for the bot token; webhook and `getUpdates` must not run simultaneously for the same token.[1]

The bot token belongs in a managed secret store. The ingress service must use update identifiers for idempotency, reject unsupported commands and selectors, and never place tokens or raw credentials into Work, Loop, Action, Evidence, logs, or customer-visible replies.

## Safety controls

A roaming user must select a tenant, site, or explicit router scope when memberships span multiple tenants. A router health check requires the `router.health.read` capability, a valid site membership, an enrolled router, and a registered adapter. The adapter receives a scoped, short-lived execution context; it does not make authorization decisions and does not return device secrets.

Every result is recorded as Evidence. Unavailable adapters, failed checks, identity mismatches, and policy denials are explicit outcomes rather than silent skips. Outbound Telegram messages are summaries of verified evidence and must not expose data from another tenant.

## Deployment choices

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---:|---:|
| Managed web service with durable database, queue, webhook ingress, and scheduled workers | Best operational fit; managed TLS and scaling; requires provider secrets and database/queue setup | Usage-based | Medium |
| Always-on cloud worker with PostgreSQL and Redis-compatible queue | More control for custom network access and large router fleets; adds operations, patching, and monitoring responsibility | Infrastructure-dependent | High |
| Single scheduled script | Lowest setup cost, but poor for event latency, retries, idempotency, fairness, and 1,000-tenant growth | Low initially | Low but not production-suitable at scale |

## Current implementation boundary

The repository now includes `HealthChannelIngress`, `HealthTargetRegistry`, `HealthCheckOrchestrator`, and `HealthPollingCoordinator`. These provide deterministic contracts and regression coverage. Durable cloud persistence, RLS migrations, queue provisioning, Telegram credentials, adapter implementations, and production deployment remain environment-specific gates and must be configured before live polling is enabled.

## References

[1]: https://core.telegram.org/bots/api "Telegram Bot API"
