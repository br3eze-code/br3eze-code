---
name: schedule
description: Design safe Claude Code scheduled routines and local loops for recurring AgentOS audits, reports, and PR triage, with clear local-versus-cloud boundaries.
argument-hint: "[daily audit|CI triage|server health]"
---

# AgentOS scheduled operations

First classify where the task must run.

- Use Claude Code `/schedule` for recurring cloud routines that inspect GitHub/connected services, prepare reports, or propose fixes/PRs. State the repository, cadence, required connectors, output location, and whether the routine may open a PR.
- Use `/loop` for short-lived polling in the current local Claude Code session. It is not a durable scheduler and should not be treated as a process supervisor.
- Use a local process manager or operating-system scheduler for work that must access local files, a local database, a private router, or `localhost`.
- Cloud routines cannot directly reach private `127.0.0.1` or a laptop's filesystem just because the repository is connected.
- Do not expose an unauthenticated server endpoint to make a cloud task reach local infrastructure.

Recommended routine: daily PR health report. Inspect open PRs, CI failures, merge conflicts, stale branches, dependency overlap, and unresolved review threads. Produce a prioritized report and suggested patches. Do not merge PRs, alter permissions, change production infrastructure, or perform destructive account actions automatically.

For any recurring mutation, define least-privilege credentials, bounded runtime/cost, idempotency, audit evidence, failure notifications, and a human approval boundary before scheduling.
