# AI Agent Identity and Trust Architecture

Status: implementation design prepared against the current `main` tree. This document is a Br3eze design, not a claim of IronWiFi partnership or feature parity.

## 1. Design source and important boundary

IronWiFi's AI Agent Identity material describes network-layer identity: certificates, 802.1X/EAP-TLS admission, purpose-scoped network placement, behavioural monitoring, certificate lifecycle and response. Its detailed agent-host material explicitly distinguishes a machine's network identity from the identity of each agent process. Br3eze therefore needs two linked but separate identity planes:

1. **Agent/process identity (AgentOS):** identifies a particular agent instance, its owner, tenant, purpose, parent/orchestrator, allowed tools, scopes, credential lifecycle and execution history.
2. **Host/network identity (Power Connect):** identifies the machine or router joining a managed network, using device credentials and network policy. Do not claim that 802.1X authenticates individual processes when it authenticates only their host.

References: https://www.ironwifi.com/ai-agent-identity and https://www.ironwifi.com/lp/ai-agent-identity

## 2. Existing Br3eze implementation evidence

Inspected on `main`:

- `src/core/agent-registry.js`: canonical in-memory registry for role/profile definitions. It supports register/get/list/remove, but is not a persistent per-instance identity store and does not issue credentials.
- `src/core/agent-role-profiles.js`: role-level capability and approval hints. Its header correctly says profiles do not grant permissions by themselves.
- `src/core/specialists/SpecialistContext.js`: request context carries tenant, user, project, role, permissions, approvals and providers. It currently has no immutable agent-instance identity, parent identity, credential ID, host identity or policy revision.
- `server/src/auth/identity.js`: verifies Supabase Auth access tokens for human users and a separately configured service token for machine calls. OAuth providers such as Google, GitHub, Microsoft/Azure, Apple and Facebook federate through Supabase; the server does not run provider callbacks or maintain a second user database. The service token still maps to broad `permissions: ['*']` and is not a per-agent credential.
- `src/runtime/skill.js`: tool definitions carry permission, specialist, ticket type and risk metadata. This is useful enforcement metadata but does not alone establish a trusted agent principal.
- `src/runtime/skills/procurement.js`: procurement tools are tenant-scoped and purchase proposals require approval; product-reference and provisioning tools already exist.
- `server/src/domains/procurement/registerRoutes.js`: supplier APIs authenticate the caller, resolve tenant/project from a user profile, and reload persisted approvals before a purchase order is sent.

These are complementary building blocks, not a complete AI agent identity service.

## 3. Target architecture

### 3.1 Canonical AgentIdentity record

Persist each executable agent instance separately from its role profile:

```json
{
  "agentId": "agt_<opaque-id>",
  "tenantId": "tenant-a",
  "projectId": "project-a",
  "ownerUserId": "user-a",
  "role": "procurement",
  "agentType": "autonomous",
  "purpose": "compare suppliers and prepare approved replenishment orders",
  "status": "active",
  "parentAgentId": null,
  "hostId": "host_<opaque-id>",
  "capabilities": ["catalog:read", "procurement:read", "procurement:write"],
  "resourceScopes": ["project:project-a"],
  "approvalRequired": ["purchase.order", "settlement.release"],
  "credentialId": "cred_<opaque-id>",
  "policyVersion": 1,
  "createdAt": "server timestamp",
  "expiresAt": "server timestamp"
}
```

Treat role/profile metadata as defaults only. Effective authority is the intersection of tenant policy, agent-instance grants, owner grants, tool requirements, resource scope and current lifecycle status. Never trust client-supplied tenant, permissions, role, parent ID or approval status.

### 3.2 Credential strategy

- Use short-lived, signed agent access tokens with explicit `iss`, `aud`, `sub=agentId`, `tenantId`, `projectId`, `credentialId`, `policyVersion`, `iat`, `nbf`, `exp`, and a unique `jti`.
- Keep signing keys in the server secret manager; support key IDs and rotation. Do not use the global service token as every agent's identity.
- Store only credential metadata and revocation state server-side; never store reusable plaintext secrets in agent records.
- Rotate/revoke credentials when an agent is disabled, owner membership is removed, policy is tightened, host trust is revoked, or compromise is suspected.
- For networked agent hosts that support it, add a separate host certificate and 802.1X/EAP-TLS integration. Do not make host certificates a prerequisite for cloud-hosted agents.

### 3.3 Authorization

At every tool invocation, resolve a trusted principal from verified credentials and reload or validate current agent status/policy. Enforce:

1. active agent and active owner;
2. exact tenant and project match;
3. parent-child registration and delegation limits for spawned agents;
4. required capability and resource scope;
5. tool risk policy and persisted human approval for consequential actions;
6. budget, rate and concurrency limits;
7. policy-version and credential-revocation checks.

A role name is not a permission. A tool description is not an authorization check. Approval must be persisted, action-specific, resource-scoped, tenant-scoped, project-scoped, unexpired and single-use or otherwise replay-protected.

### 3.4 Agent lifecycle

`PENDING → ACTIVE → RESTRICTED → REVOKED → DECOMMISSIONED`

- PENDING: registration awaiting owner/policy approval.
- ACTIVE: allowed within granted scope.
- RESTRICTED: anomaly or policy issue; read-only/limited tools.
- REVOKED: no new sessions or tool calls; invalidate credentials and revoke host/network access where integrated.
- DECOMMISSIONED: retained audit record, no runtime authority.

Do not delete identity records on revocation; preserve audit history.

### 3.5 Parent/child agent model

An orchestrator can register child agents only when its own policy permits `agent.spawn`. A child inherits no more authority than the intersection of the parent's delegated grants and the child role's allowed capabilities. Record parent ID, spawn reason, task/correlation ID, expiry, budget and allowed tools. Prevent cycles, unbounded fan-out and orphaned child agents. Revoking a parent must suspend or review its descendants.

### 3.6 Behavioural monitoring and response

Start with explainable per-agent counters and event features, not an opaque ML classifier:

- tool calls per minute and per hour;
- denied calls and approval bypass attempts;
- new tools, resources, projects, host IDs and network segments;
- unusual time windows;
- token issuance and refresh patterns;
- supplier/payment/inventory mutations and their outcomes;
- child-agent creation rate and depth;
- outbound destinations and data-volume summaries where legally and technically available.

Use a configurable baseline window and minimum sample count. Alert first; automatic restriction should require deterministic high-confidence rules and have a safe recovery path. Record why an action was taken. Network events must remain distinct from application/tool events.

## 4. Proposed modules and APIs

Add a domain-neutral identity subsystem; keep supplier and Wi-Fi business logic out of core:

- `src/core/identity/agent-identity.js`: immutable identity value object and schema validation.
- `src/core/identity/agent-policy.js`: effective-capability calculation and deny-by-default policy decisions.
- `src/core/identity/agent-credential.js`: token claims/validation contracts; cryptographic signing stays behind server adapter.
- `src/core/identity/agent-lifecycle.js`: legal state transitions.
- `server/src/identity/agent-identity-store.js`: persistence adapter (Firestore initially, interface provider-neutral).
- `server/src/identity/agent-identity-routes.js`: authenticated registration, get/list, suspend, revoke, rotate and audit endpoints.
- `server/src/identity/agent-authentication.js`: agent-token verification and trusted principal construction.
- `server/src/identity/agent-audit-store.js`: append-only security events.
- `src/runtime/agent-tool-guard.js`: central tool invocation guard, called by the canonical tool registry/executor rather than duplicated in each skill.

Suggested endpoints:

- `POST /api/v1/agents` — register a pending agent; owner and policy checks.
- `GET /api/v1/agents/:agentId` — read within tenant/project scope.
- `GET /api/v1/agents` — tenant-scoped inventory and filters.
- `POST /api/v1/agents/:agentId/approve` — approve registration and grants.
- `POST /api/v1/agents/:agentId/credentials` — issue short-lived credential.
- `POST /api/v1/agents/:agentId/rotate` — rotate credential.
- `POST /api/v1/agents/:agentId/restrict` — restrict execution.
- `POST /api/v1/agents/:agentId/revoke` — revoke credentials and execution.
- `GET /api/v1/agents/:agentId/events` — authorized audit trail.

All mutations require idempotency keys and durable audit events.

## 5. Integration points

- Keep `AgentRegistry` as the in-memory registry of role/skill definitions; do not turn it into the database of running identities.
- Extend `SpecialistContext` with a server-created, immutable `principal` object containing agent and host identity. Never let the model populate it.
- Put the enforcement check in the canonical tool execution path so direct tool calls, skills, MCP and A2A routes share one guard.
- Procurement must receive only the scoped supplier capabilities granted to that agent. Purchase order, invoice settlement, refunds and supplier account changes remain approval-gated.
- For MikroTik/Power Connect, map host/device identity to network policy separately. An agent process on a host inherits the host's network reachability, but not the host's application permissions.
- Add connector adapters for certificate authorities, RADIUS/802.1X and device inventory later; keep the first release useful without a commercial RADIUS provider.

## 6. Regression and security tests

1. Agent identity cannot be forged by request body or model output.
2. Tenant A cannot list, read, rotate, suspend or revoke tenant B's agents.
3. Project A cannot access project B resources by changing IDs.
4. Revoked/expired credentials fail immediately on the next request.
5. Credential rotation invalidates the previous credential according to policy.
6. Unknown `kid`, invalid signature, wrong issuer/audience, expired token and replayed `jti` are rejected.
7. Role/profile registration alone grants no authority.
8. Effective permissions are the intersection of all grants; one missing grant denies.
9. Parent cannot delegate capabilities it does not possess; children cannot escalate.
10. Revoking a parent suspends or flags descendants.
11. Every registration, grant, denial, approval, rotation, restriction and revocation produces an auditable event.
12. Tool invocation is denied when policy version or identity status changes mid-session.
13. Rate, budget, fan-out and concurrency limits are enforced server-side.
14. Host certificate identity and agent process identity cannot be confused.
15. Existing user, supplier provisioning, Wi-Fi, skill and runtime tests remain green.

## 7. Delivery sequence

**Phase 0 — harden current boundary:** remove wildcard service-token authority from general agent use; ensure all providers establish tenant/project scope; add central authorization tests and audit coverage.

**Phase 1 — application identity MVP:** persistent agent records, registration/approval, short-lived credentials, lifecycle, tenant/project authorization, central tool guard, inventory endpoints.

**Phase 2 — delegation and monitoring:** parent-child identity, budgets, rate/concurrency limits, baseline events, alerts, restriction and recovery.

**Phase 3 — host/network identity:** device certificates, RADIUS/802.1X/EAP-TLS adapter, host-to-agent association, network policy mapping, and revocation integration where supported.

**Phase 4 — federation and scale:** external identity provider integration, certificate authority adapters, SCIM/enterprise directory synchronization, multi-region key rotation and operational dashboards.

## 8. Acceptance gate

Do not call the feature production-ready until the Phase 1 tests pass, existing test suites remain green, the server-side secret and token configuration is reviewed, and the identity inventory can answer: which agent is running, who owns it, which tenant/project it belongs to, what it can do, which host it runs on, what it did, and how to revoke it.

No IronWiFi API, certificate service, RADIUS endpoint or partnership is assumed by this design. Those require separate provider contracts and credentials.
