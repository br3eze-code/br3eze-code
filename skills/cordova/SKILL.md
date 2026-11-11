---
name: cordova
description: Build, debug, test, and maintain the AgentOS Cordova mobile application, including plugin integration, platform compatibility, offline behavior, and release readiness. Use when changing Cordova app code or investigating mobile-only behavior.
---

# Cordova Mobile Engineering

## Mission

Own the Cordova-specific engineering workflow for AgentOS mobile clients. Keep shared business logic and execution policy in their canonical owners; this skill coordinates mobile implementation and platform integration rather than creating a second runtime.

## Use this skill when

- Updating Cordova application startup, navigation, or lifecycle behavior.
- Integrating or debugging Cordova plugins such as Wi-Fi, SQLite, permissions, or notifications.
- Investigating Android device or OS-version compatibility.
- Reviewing offline-first behavior, local persistence, synchronization, or reconnect flows.
- Preparing a mobile build or diagnosing a reproducible mobile-only defect.

## Workflow

1. **Inspect before editing.** Identify the app entry point, relevant plugin declarations, platform versions, existing tests, and current implementation. Reuse existing abstractions.
2. **Define the boundary.** Keep UI concerns in the app, mobile platform concerns behind Cordova/plugin adapters, and shared business policy in the canonical AgentOS runtime or domain owner.
3. **Reproduce the issue.** Record device/OS, plugin versions, permissions, network state, steps, observed behavior, and expected behavior. Do not infer that a device-specific report proves a universal defect.
4. **Patch minimally.** Avoid parallel implementations of authentication, billing, synchronization, or agent execution. Preserve graceful offline behavior where already supported.
5. **Validate.** Run focused tests and applicable lint/build checks. For platform-dependent behavior, state which device/emulator and OS were actually tested; never claim physical-device verification from unit tests alone.
6. **Report evidence.** Summarize changed files, test commands and results, remaining platform coverage, migration needs, and rollback considerations.

## Safety and ownership rules

- Treat permissions, authentication tokens, vouchers, user data, and local databases as sensitive.
- Do not log credentials, OTPs, full tokens, or unnecessary personal data.
- Do not silently widen Android permissions or bypass platform security prompts.
- Use the existing synchronization owner; make retries idempotent and handle stale/offline data explicitly.
- Do not execute router or host commands from a mobile UI without the established authorization and host-owned execution path.
- Do not claim that a build, test, emulator, or device check passed unless its result was observed.

## Completion criteria

The change has a clear reproduction or acceptance test, preserves canonical ownership, includes appropriate automated coverage, documents any platform-specific limitations, and reports exact verification evidence.

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
