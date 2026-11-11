---
name: project
description: "CPM (Critical Path Method) and EVM (Earned Value Management) project tracking engine. Stores projects in the AgentOS database, computes forward/backward passes to find the critical path, and calculate"
---

# Skill: project

**Version:** 2026.7.0  
**Dispatcher:** `manage_project`  
**Domain:** productivity

## Description

CPM (Critical Path Method) and EVM (Earned Value Management) project tracking engine. Stores projects in the AgentOS database, computes forward/backward passes to find the critical path, and calculates SPI, CPI, ETC, EAC, and other earned value metrics. EVM data sources: voucher revenue as EV/PV, LLM token spend + infra cost as AC.

## When to Use

Invoke when the user asks about:
- Creating or managing a project with tasks and dependencies
- Finding the critical path or schedule float
- Calculating earned value metrics (SPI, CPI, EAC, VAC…)
- Generating a CPM + EVM combined project report
- Exporting project data

## Tools (9 Actions)

| Action | Description |
|---|---|
| `project.create` | Create project with tasks, dependencies, and BAC |
| `project.list` | List all projects |
| `project.get` | Get project by ID |
| `project.update` | Update project or task fields |
| `project.delete` | Delete a project |
| `project.critical_path` | Run CPM — returns ES/EF/LS/LF/float and critical path |
| `project.evm` | Calculate EVM metrics |
| `project.report` | Combined CPM + EVM report with health indicators |
| `project.export` | Export full project data as JSON |

## CPM Algorithm

- **Forward pass:** ES, EF computed via recursive dependency traversal
- **Backward pass:** LS, LF, float
- **Critical path:** all tasks where `float === 0`

## EVM Metrics

| Metric | Formula |
|---|---|
| SPI | EV / PV |
| CPI | EV / AC |
| SV | EV − PV |
| CV | EV − AC |
| ETC | (BAC − EV) / CPI |
| EAC | AC + ETC |
| VAC | BAC − EAC |
| TCPI | (BAC − EV) / (BAC − AC) |

## Example: Create Project

```json
{
  "action": "project.create",
  "project": {
    "name": "Network Expansion Q3",
    "bac": 5000,
    "tasks": [
      { "id": "t1", "title": "Site survey",      "duration": 2,  "dependencies": [],         "plannedValue": 500 },
      { "id": "t2", "title": "Cable install",    "duration": 5,  "dependencies": ["t1"],     "plannedValue": 2000 },
      { "id": "t3", "title": "Router config",    "duration": 3,  "dependencies": ["t2"],     "plannedValue": 1500 },
      { "id": "t4", "title": "User onboarding",  "duration": 2,  "dependencies": ["t3"],     "plannedValue": 1000 }
    ]
  }
}
```

## Example: EVM Report

```json
{
  "action": "project.report",
  "id": "proj-1234567890"
}
```

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
