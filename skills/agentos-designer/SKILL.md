---
name: agentos-designer
description: Design user, service, and system solutions in AgentOS from scoped requirements, constraints, alternatives, prototypes, reviews, acceptance criteria, and controlled publication. Use for design briefs, concepts, UX, service flows, architecture proposals, and design changes.
---

# AgentOS Designer

Use this skill to transform authorized needs into reviewable design proposals. Confirm `userId`, `tenantId`, `projectId`, `siteId`, domain, audience, constraints, and acceptance criteria before using project or customer context.

## Workflow

```text
extract user and service needs
→ define design principles and constraints
→ produce alternatives and trade-offs
→ prototype or model
→ request review
→ resolve comments
→ prepare approved design package
```

Use the canonical WBS sequence:

```text
DES-001 needs and task model
→ DES-002 design principles
→ DES-003 concept options and trade-offs
→ DES-004 prototype and review
→ DES-005 approved design package
```

## Design activity

Create a stable activity such as `ACT-DESIGNER-WP-DES-003`. Include the source requirements, target users, constraints, alternatives, decision criteria, expected outcome, acceptance criteria, reviewers, evidence references, and approval state. Link prototypes and decisions to the WBS package.

Design outcomes must be testable. State what the design enables, which constraints it satisfies, what remains uncertain, and how it will be verified. Mark assumptions as assumptions; do not present a visual prototype as production-ready implementation.

## Collaboration

Request technical constraints from Engineering, document standards from Draftsman, schedule and budget constraints from Planner and Accountant, stakeholder input through Secretary, and QA acceptance criteria before finalizing. Use review activities and explicit comment resolution rather than informal approval in chat.

## Approval and safety

Use `requirements.read`, `design.propose`, `prototype.create`, and `review.request`. Require approval for `design.publish`, `asset.publish`, and `brand.change`. Do not publish shared assets, change brand standards, or direct implementation from an unapproved concept.

## Outputs

Return:

```text
needs and audience
constraints and design principles
alternatives and trade-offs
selected recommendation and rationale
prototype or design references
acceptance criteria
open questions and risks
reviewers and approval state
handoff to Engineer or Draftsman
```

Preserve tenant and project scope. Render activity number, review status, comments, and next action consistently across channels. A design is complete only when required review evidence and approval are recorded.

## Shared AgentOS operating contract

This file defines specialist knowledge and procedure; it is not a second execution system and does not grant permissions.

### Architecture and ownership
- Keep one execution owner: `src/core/agentRuntime.js`; compatibility shims are not parallel runtimes. Keep one gateway owner and reuse its existing routes.
- Preserve the distinction: WBS/work package = why/where; specialist = accountable who; skill = how; tool/adapter = what executes; policy = whether allowed; evidence/event = what happened; verification = whether acceptance criteria passed.
- Follow: identity/scope → WBS and dependency check → accountable specialist → skill → declared capability/tool → policy/approval → bounded execution → observation → verification/acceptance → evidence/event → next work item.
- Reuse canonical registries, activity/task records, event stores, and domain owners. Channels (PWA/web, CLI, desktop/mobile, and configured messaging channels) are adapters, not alternate policy owners or permission bypasses.

### Specialist boundaries and handoffs
- Own only the state or record within this skill's domain. Route by the state that will change, not the channel or wording of the request.
- Every work package needs an owner, dependencies, capability/skill, declared tools, policy, acceptance criteria, evidence, outcome, and activity/event record.
- Handoffs state source/destination owners, WBS/activity IDs, tenant/project/site/domain scope, object IDs, requested action, evidence, due date, acceptance criteria, approval status, and return path.
- Keep catalog, pricing, inventory, orders, vouchers/access, fulfillment, procurement, and billing/payment ownership separate. Project Manager coordinates cross-team work; Product Specialist routes commerce work; neither silently takes over domain state.

### Permissions and safe execution
- Skill instructions are not authorization. Validate authenticated identity and applicable tenant, project, site, domain, environment, object scope, capability, and policy before access or mutation.
- Prefer read-only inspection and dry-run proposals. Recheck authorization immediately before consequential changes. Require approval for irreversible, high-value, externally visible, security-sensitive, payment-related, deployment, device/network-changing, or contractually binding actions.
- Never expose credentials, tokens, OTPs, passwords, or unnecessary personal data. Enforce tenant isolation and redact logs/evidence.
- Use stable IDs, explicit state transitions, idempotency, bounded retries/timeouts, and safe failure handling. Apply `maxIterations`, `maxToolCalls`, `maxCost`, `maxDurationMs`, and `maxHandoffs` where supported; stop and escalate when limits or authority are insufficient.

### Evidence and verification
- Record baseline, risks, approvals, changed resources, tool results, test output, observed result, evidence references, unresolved defects, and rollback/recovery status through existing activity/audit paths.
- Define acceptance and rollback before mutation. Add regression tests for fixes; run focused tests, relevant lint/build checks, and CI as appropriate. Keep manifests and lockfiles consistent; use repository-required clean-install checks such as `npm ci`.
- Never claim a test, device, provider, deployment, or live tenant was verified unless its result was observed. Distinguish code inspection, unit tests, staging, and production evidence.
- Finish with outcome, owner, changes, exact checks/results, evidence, remaining risks, approvals, and next handoff.

### Provider and environment boundaries
- Providers are swappable, but each capability has one owner. Keep provider-specific behavior behind adapters; do not move Firebase, Supabase/Postgres, Vercel, AWS, Cloudflare, payment, messaging, MikroTik/RouterOS, or Starlink logic into core policy unless the existing architecture assigns it there.
- Mentioned integrations are not proof of live credentials, deployments, or connectivity. Use only configured and authorized tools. Do not assume browser `process`, filesystem, secrets, Node APIs, or network access exist in a PWA; use the correct server/API boundary.
- Separate product entitlement and billing decisions from router/device mutation. Disruptive network operations require scoped permission, explicit confirmation, audit logging, and post-change verification.

### skills.sh compatibility
- Keep YAML frontmatter with a stable `name` and useful `description`. Preserve this skill's domain-specific workflow and constraints.
- Install with `npx skills add br3eze-code/br3eze-code --skill <skill-name>`; `npx skills list` lists workspace-installed skills, not every source package. Repository guidance specifies Node.js 22.20+.
- Skill installation is not runtime registration. Skill prose must not replace executable modules or create another execution path.
