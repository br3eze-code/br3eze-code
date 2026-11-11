---
name: agentos-role-skill-factory
description: Create, validate, integrate, and release separate AgentOS role-skill packages with SKILL.md instructions and index.js entry points. Use when adding a specialist role, generating role metadata, wiring WBS and approval contracts, or packaging role skills for the repository.
---

# AgentOS Role-Skill Factory

Use this skill to create one or more domain-agnostic AgentOS specialist packages. Each package must contain a validated `SKILL.md` and an executable `index.js` entry point that exports role metadata and a tenant-scoped execution-context factory.

## Workflow

```text
inspect canonical role profile and WBS catalog
→ define responsibility and authority boundaries
→ define skills, approval-required actions, outcomes, evidence, and handoffs
→ initialize or update the skill package
→ write SKILL.md with valid frontmatter
→ write index.js metadata and context factory
→ validate every package
→ copy packages into repository skills/
→ run integration tests and syntax checks
→ review diff, commit, push, and verify remote
```

## Required package contract

```text
skills/agentos-{role}/
├── SKILL.md
└── index.js
```

`SKILL.md` must contain YAML `name` and `description` frontmatter, imperative workflow instructions, role boundaries, approval gates, evidence rules, tenant isolation, activity tracking, channel behavior, and outputs. Keep it concise and under 500 lines.

`index.js` must export:

```js
export const specialist = {
  role,
  kind,
  approvalRequired,
  createContext(input)
};
export const role;
export const createContext;
export default specialist;
```

`createContext` must require at least `userId` and `tenantId`, attach the canonical `agentRole` and `skillPackage`, and expose approval metadata without granting authorization. Runtime policy must re-check identity, tenant, project, site, capability, status, and approval before execution.

## Role design

For every role, document:

```text
purpose and responsibility
allowed skills and read operations
mutation or commitment approvals
WBS packages and dependencies
activity number and expected outcome
evidence and acceptance criteria
handoff targets and escalation rules
channel rendering and privacy limits
onboarding and readiness checks
```

Do not make one role responsible for another role’s authority. Project Manager coordinates; Planner plans; Engineer validates and implements bounded technical work; Accountant reconciles; Secretary records and routes; Procurement sources and compares; Expeditor tracks fulfillment; Designer defines design intent; Draftsman controls drawings; QA verifies; Editor controls revisions and publication.

## Validation

Run the skill validator for every source package:

```bash
python /home/ubuntu/skills/skill-creator/scripts/quick_validate.py /home/ubuntu/skills/agentos-{role}
```

Then validate repository copies, all entry-point imports, missing-context rejection, tenant preservation, and approval metadata. Run focused WBS, activity, channel, POS/order, courier, payment, and specialist integration tests before committing.

## Safety and release

Never include credentials, runtime state, generated databases, or accidental artifacts. Do not commit until the diff is reviewed, whitespace checks pass, tests are reproducible, and the package list is explicit. Push only after the commit is created and verify that local and remote HEAD match.

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
