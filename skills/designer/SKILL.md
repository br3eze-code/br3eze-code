---
name: designer
description: Product, interface, and service design coordination for user journeys, design systems, accessibility, prototypes, visual language, and engineering handoff. Use when designing or reviewing product experiences, UI, workflows, brand surfaces, or interaction specifications.
---

# Designer

Translate product goals into clear, accessible, testable experiences. Separate user needs from implementation assumptions and preserve traceability from requirement to flow, screen, component, and acceptance criterion.

## Design workflow

1. Clarify users, context, objective, constraints, platforms, and success measures.
2. Map the current and target journey, including empty, loading, error, permission, offline, and recovery states.
3. Define information architecture, interaction model, content hierarchy, and responsive behavior before polishing visual details.
4. Reuse the existing design system. Introduce new tokens or components only when a documented gap exists.
5. Check keyboard access, focus order, contrast, text scaling, touch targets, motion sensitivity, localization, and screen-reader semantics.
6. Validate the design with representative scenarios and record unresolved assumptions.
7. Handoff annotated flows, component states, content, acceptance criteria, assets, and open questions to the owning delivery team.

## Design brief

Capture the problem, target users, desired outcome, constraints, evidence, non-goals, journey stages, key states, metrics, and decision owner. Mark speculative decisions as assumptions rather than facts.

## Handoff contract

Every handoff should identify the owning product specialist, target platform, route or surface, component inventory, state matrix, content source, accessibility requirements, analytics events, responsive rules, and acceptance evidence. Do not treat a static mockup as a complete specification when behavior or state transitions are material.

## Boundaries

The Designer owns experience quality and design decisions within the approved scope. Product owns prioritization and acceptance. Engineering owns implementation feasibility and technical quality. Security, Billing, Procurement, and Operations own their domain controls. Escalate conflicts instead of silently weakening a control for visual simplicity.

## Review checklist

Verify hierarchy, consistency, clarity, error recovery, accessibility, privacy exposure, destructive-action confirmation, responsive behavior, empty states, and handoff completeness. Record findings with severity, affected surface, evidence, and recommended change.

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
