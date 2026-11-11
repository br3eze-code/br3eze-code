---
name: agentos-live-project-observer
description: Observe and summarize active AgentOS work across supported IDEs, agents, GitHub, CI, local server logs and deployment providers, with redaction, consent, read-only defaults and evidence-backed next priorities.
---

# Live Project Observer

## Mission

Give the operator one current, evidence-based view of what the multi-agent system and project are doing. This is an observer/coordinator, not another execution runtime. It must never silently take over another agent's work.

## Event sources

Use only sources actually connected and authorized: AgentRuntime activity/events, gateway health/status, approved local server logs, GitHub branches/PRs/checks, CI runs, Vercel deployment status, Android release metadata and explicitly connected IDE sessions. Mark unavailable sources as unavailable; do not fabricate real-time coverage.

## Workflow

1. Establish the operator, project/tenant scope, approved data sources, refresh mode and retention/redaction policy.
2. Read current WBS activities and map each to one owner, state, latest event, dependency, evidence and next action.
3. Prefer event subscriptions/webhooks where implemented; otherwise use bounded polling with backoff and cursors. Do not create busy loops or multiple observers for the same event stream.
4. Normalize observations to: `eventId`, `timestamp`, `source`, `projectId`, `activityId`, `owner`, `severity`, `status`, `summary`, `evidenceRef`, `redactionApplied`.
5. Redact credentials, cookies, access tokens, personal data and sensitive payloads before storing or showing events. Never expose environment variables, private keys, user messages outside the approved project, or raw authorization headers.
6. Detect blocked activities, failing checks, stale heartbeats, duplicate owners, unreviewed dependency changes and deployment drift. Correlate rather than duplicate alerts.
7. Present a concise timeline and the next priority. Offer a proposed repair or create a WBS activity; execution and mutations stay with the owning specialist and require approval when sensitive.

## Modes and limits

- Default: read-only, on-demand snapshot.
- Continuous mode: explicit opt-in, bounded rate, visible status, stop control and redaction.
- Cloud agents cannot observe a private localhost process unless a deliberate, secured bridge or connector is installed and authorized.
- Never claim to watch every IDE or agent unless each source is actually connected and verified.

## Output

Current project state, source coverage, event freshness, WBS owners and blockers, exact evidence, alerts, data gaps and one next priority.


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- For multi-step work, use durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; use explicit cross-domain handoffs. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer platform built-ins and existing locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation. Apply least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, production, release, financial, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
