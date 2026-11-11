---
name: mesh
description: "Multi-router mesh management via the AgentOS NodeRegistry. Supports registering router nodes, listing the fleet, executing a tool on a specific node, and broadcasting a tool call across all nodes simu"
---

# Skill: mesh

**Version:** 2026.7.0  
**Dispatcher:** `manage_mesh`  
**Domain:** networking

## Description

Multi-router mesh management via the AgentOS NodeRegistry. Supports registering router nodes, listing the fleet, executing a tool on a specific node, and broadcasting a tool call across all nodes simultaneously with parallel execution.

## When to Use

Invoke when the user asks about:
- Listing all registered routers in the mesh
- Adding a new router to the fleet
- Running a command on a specific router node
- Running a command across all routers at once

## Tools

| Action | Description |
|---|---|
| `nodes.list` | List all registered mesh nodes |
| `nodes.register` | Register a new router node |
| `nodes.exec` | Execute a tool on a specific named node |
| `mesh.exec` | Execute a tool on all nodes simultaneously |

## Parameters

**Register a node:**
```json
{
  "action": "nodes.register",
  "name": "site-b-router",
  "host": "192.168.10.1",
  "port": 8728,
  "user": "admin",
  "password": "secret",
  "role": "branch"
}
```

**Execute on specific node:**
```json
{
  "action": "nodes.exec",
  "name": "site-b-router",
  "tool": "users.active",
  "params": {}
}
```

**Execute across all nodes:**
```json
{
  "action": "mesh.exec",
  "tool": "system.stats",
  "params": {}
}
```

## Node Roles

| Role | Description |
|---|---|
| `core` | Primary/main gateway router |
| `branch` | Branch or site router |
| `edge` | Edge or access point |

## HTTP API

- `GET /api/nodes` — List nodes
- `POST /api/nodes` — Register node
- `POST /api/nodes/:name/exec` — Execute tool on node
- `GET /api/mesh/exec` — Execute tool on all nodes

## Shared AgentOS operating contract
This is specialist procedure, not a second execution system or permission grant.
### Architecture and ownership
- One execution owner: `src/core/agentRuntime.js`; compatibility shims are not parallel runtimes. Reuse the single gateway owner and its routes.
- WBS/work package = why/where; specialist = accountable who; skill = how; tool/adapter = what executes; policy = whether allowed; evidence/event = what happened; verification = acceptance.
- Follow identity/scope → WBS/dependencies → accountable specialist → skill → declared tool → policy/approval → bounded execution → observation → verification → evidence/event → next work item.
- Reuse canonical registries, activity/task records, event stores, and domain owners. PWA/web, CLI, desktop/mobile, and configured messaging channels are adapters, not alternate policy owners.
### Boundaries and handoffs
- Own only this skill's state/record. Route by the state that changes, not the channel or phrasing. Every work package needs owner, dependencies, capability/skill, tools, policy, acceptance criteria, evidence, outcome, and activity/event record.
- Handoffs include source/destination owners, WBS/activity IDs, tenant/project/site/domain scope, object IDs, requested action, evidence, due date, acceptance criteria, approval status, and return path.
- Keep catalog, pricing, inventory, orders, vouchers/access, fulfillment, procurement, and billing/payment ownership separate. Project Manager coordinates; Product Specialist routes commerce; neither silently assumes domain authority.
### Permissions and safe execution
- Skill prose is not authorization. Validate identity, tenant/project/site/domain, environment, object scope, capability, and policy before access or mutation.
- Prefer read-only inspection/dry runs. Recheck authorization before consequential changes. Approval is required for irreversible, high-value, externally visible, security-sensitive, payment, deployment, device/network, or contractually binding actions.
- Never expose secrets, tokens, OTPs, passwords, or unnecessary personal data. Enforce tenant isolation and redact evidence/logs.
- Use stable IDs, explicit state transitions, idempotency, bounded retries/timeouts, and safe failure handling. Enforce `maxIterations`, `maxToolCalls`, `maxCost`, `maxDurationMs`, and `maxHandoffs` where supported; escalate if limits or authority are insufficient.
### Evidence and verification
- Record baseline, risks, approvals, changed resources, tool results, tests, observed result, evidence references, defects, and rollback/recovery status through existing activity/audit paths.
- Define acceptance and rollback before mutation. Add regression tests; run focused tests, relevant lint/build checks, and CI. Keep manifests/lockfiles consistent; run `npm ci` when required by repository workflows.
- Never claim tests, devices, providers, deployments, or live tenants were verified without observed results. Separate code inspection, unit tests, staging, and production evidence.
- Report outcome, owner, changes, exact checks/results, evidence, risks, approvals, and next handoff.
### Provider and environment boundaries
- Providers are swappable; every capability still has one owner. Keep Firebase, Supabase/Postgres, Vercel, AWS, Cloudflare, payment/messaging, MikroTik/RouterOS, and Starlink behavior behind adapters unless core explicitly owns it.
- Mentioned integrations do not prove live credentials or connectivity. Use only configured/authorized tools. Do not assume browser `process`, filesystem, secrets, Node APIs, or network access exist in a PWA; use the proper server/API boundary.
- Separate product entitlement/billing from router/device mutation. Disruptive network operations need scoped permission, confirmation, audit, and post-change verification.
### skills.sh compatibility
- Maintain YAML frontmatter with stable `name` and useful `description`; preserve specialist-specific instructions.
- Install with `npx skills add br3eze-code/br3eze-code --skill <skill-name>`; `npx skills list` shows workspace-installed skills, not every source package. Repository guidance specifies Node.js 22.20+.
- Installation is not runtime registration; skill prose must not replace executable modules or create another execution path.
