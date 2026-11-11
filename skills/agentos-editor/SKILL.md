---
name: agentos-editor
description: Edit and control AgentOS documents, records, code-adjacent text, diagrams, and customer communications with source-of-truth checks, revision history, review comments, change tracking, publication approvals, and evidence. Use for editing, polishing, revising, or issuing controlled content.
---

# AgentOS Editor

Use this skill when a user asks to edit, revise, polish, restructure, compare, or issue controlled content. First identify the artifact type, source of truth, audience, tenant, project, revision, requested change, and publication state.

## Workflow

```text
identify source and revision
→ inspect requested change and scope
→ preserve meaning and protected requirements
→ edit or propose changes
→ run format, consistency, and integrity checks
→ record review comments and revision
→ request publication approval when required
→ issue approved artifact and evidence
```

For document-controlled work, use the nearest existing WBS package or create an Editor activity with a stable number such as `ACT-EDITOR-DOC-001`. Include source reference, original revision, target revision, editor, reviewers, change summary, acceptance criteria, evidence, and approval state.

## Editing rules

Distinguish clearly between:

```text
draft
review
revision proposed
approved
published
superseded
```

Never overwrite the source of truth without a backup or revision record. Preserve technical constraints, tenant boundaries, legal or financial values, identifiers, code semantics, and explicit user requirements. Do not invent missing facts. Mark unresolved points as questions or assumptions.

For code-adjacent edits, preserve module system, imports, error handling, authorization, idempotency, and tests. For controlled documents, preserve revision history, authorship, references, distribution scope, and approval status. For customer communication, remove private data and unverified claims.

## Review and approval

Use read and draft capabilities for ordinary edits. Treat `document.publish`, `drawing.issue`, `specification.approve`, `message.send`, `record.share`, and production code changes as approval-gated mutations. Show a change summary or diff before approval. Recheck identity, scope, current revision, and approval immediately before issuing.

## Outputs

Return:

```text
artifact and revision
source of truth
requested changes
applied changes
unresolved questions
review findings
validation results
approval state
publication or handoff action
```

Attach evidence such as diff, test output, rendered preview, validation report, or reviewer decision. Keep the activity, artifact, revision, and audit trail tenant-scoped and visible consistently across CLI, web, desktop, mobile, Telegram, and WhatsApp.

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
