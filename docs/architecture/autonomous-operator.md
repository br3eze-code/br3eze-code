# Autonomous Operator: server-first implementation plan

Status: Phase B foundation implemented on the working branch; automated validation and deployment are not yet verified.

## Objective

Turn AgentOS into a persistent business operator that can accept a bounded goal, plan work, call approved capabilities, resume after process restarts, verify results, and report evidence. The first deployment should operate on engineering and low-risk business tasks before it receives production, financial, or external-communication authority.

This is not a promise of a fully hands-off company. Autonomy is earned workflow by workflow through measured reliability.

## Architecture rule

All execution must pass through the canonical `AgentRuntime` and its authorization boundary. Schedulers, channels, skills, plugins, domain adapters, and workers may submit or execute bounded steps, but must not introduce a second orchestration loop or bypass permissions.

```text
Goal / schedule / approved event
            |
            v
     Operator API + auth
            |
            v
    Persistent task/workflow store
            |
            v
 AgentRuntime -> plan -> authorize -> execute
            |                         |
            |                    approved tools
            v                         |
 observe -> verify <------------------+
            |
            v
 durable result + audit event + notification
```

## First release scope

1. Submit a goal with acceptance criteria, owner/tenant scope, deadline, and resource limits.
2. Create a durable task record before execution starts.
3. Record state transitions and step results before advancing.
4. Resume eligible work after restart without silently repeating non-idempotent actions.
5. Enforce a per-run time limit, model/tool budget, maximum turns, retry limit, and concurrency cap.
6. Verify completion against explicit acceptance criteria; distinguish completed, failed, blocked, cancelled, and awaiting approval.
7. Expose task status, recent events, errors, resource usage, and health through authenticated operator interfaces.
8. Send notifications for failures, blocked approvals, and completed tasks when a configured channel is available.
9. Support graceful shutdown: stop accepting new work, checkpoint or safely release active leases, flush records, and exit.
10. Keep the first host deployment simple: one Linux VPS, one application process managed by a process supervisor, durable storage, backups, and an explicit spend limit.

## Persistence and recovery contract

The live API, mission dispatch, user-task service, diagnostics, and system spine use `src/core/taskRegistry.js`. Its store option is wired to `src/core/file-task-store.js` by default for the single-host prototype. Task snapshots are written one JSON file per task using same-directory temporary files and atomic rename. Lifecycle events are appended to a per-task JSONL journal and fsynced; snapshots also retain event IDs and summaries. API mission creation accepts `Idempotency-Key`, fingerprints the request, and returns the original task for a matching retry while rejecting conflicting payload or scope reuse. This is single-process/single-host deduplication: snapshot and event writes are not a cross-process transaction, and external side effects are not exactly-once. The default directory is `~/.agentos/state/tasks` (profile-specific `STATE_PATH` applies). The legacy `src/taskRegistry.js` remains a consolidation item; do not add another registry.

The durable task lifecycle must support:

- [x] stable, collision-resistant task IDs;
- [x] atomic replacement of individual task snapshots;
- [x] task ownership checks on the single-task read, cancellation, and stream paths;
- [x] safe restart classification: persisted `running` tasks are marked failed/interrupted and are not replayed automatically;
- [x] append-only per-task JSONL lifecycle events with event IDs and fsync;
- [ ] atomic state transitions across task snapshots and event journal;
- [ ] claim/lease expiry for multi-worker operation;
- [x] idempotency keys and request fingerprints for task submission retries within one process/host;
- [ ] idempotency keys or equivalent guarantees for external side effects;
- [ ] retryable/blocked recovery after verified idempotency guarantees;
- bounded retries with backoff and terminal failure;
- retention, backup, and restore procedures;
- schema migrations and concurrency tests.

The current JSON adapter is deliberately a first durability milestone, not the final production queue. It avoids introducing a third registry and fits the existing synchronous store contract, but it does not provide cross-process coordination. Replace it with a tested SQLite or existing database adapter before running multiple workers or promising production-grade durability.

## Capability risk tiers

- **Tier 0 — read-only:** inspect repository files, query status, calculate metrics, read documentation.
- **Tier 1 — reversible local work:** create drafts, run tests, edit a working branch, generate reports.
- **Tier 2 — external side effects:** open pull requests, send customer messages, publish content, change non-production settings. Require narrowly scoped credentials and configured approval until the exact workflow has passed its reliability gate.
- **Tier 3 — high impact:** merge to protected branches, production deploys, spend money, alter billing/access, delete data, change router/firewall/security settings. Require explicit human approval by default; never grant blanket authority just because a model requests it.

Every tool must declare its schema, permissions, risk tier, timeout, and whether retries are safe. A model prompt is not an authorization boundary. Treat tool output and repository content as untrusted input.

## Existing components to inspect before coding

- `src/core/agentRuntime.js` — canonical execution owner and public contract.
- `src/core/taskRegistry.js` and `src/taskRegistry.js` — two task registries were found; identify the live path and consolidate rather than adding another.
- `src/core/user-task-service.js`, `src/core/missionDispatch.js`, `src/core/system-spine.js` — task submission paths to trace.
- `src/core/diagnostics.js` — existing readiness/task diagnostics.
- `src/core/heartbeat.js` — scheduler-like behavior; verify imports, lifecycle, and whether it is live before reuse.
- `scripts/automate.js` — currently monitors a health URL and copies a database file on intervals; it is not the autonomous task worker.
- Existing persistence ports, approval service, event/audit records, auth middleware, and integration tests.

Do not treat a file as live because it exists. Follow imports from actual CLI, HTTP, WebSocket, and production bootstrap entry points.

## Implementation sequence

### Phase A — prove the current path

- [x] Trace the API task submit/read/stream/cancel path to `src/core/taskRegistry.js`.
- [x] Identify the legacy process-local registry at `src/taskRegistry.js` as a remaining duplicate.
- [x] Fix mission creation to derive task scope from verified user claims and enforce ownership on task reads, cancellation, and event streams.
- [ ] Complete the full CLI, WebSocket, and channel boot-path trace.
- [ ] Run baseline unit/integration/build/security/architecture checks on one commit.

### Phase B — durable task lifecycle

- [x] Select `src/core/taskRegistry.js` as the canonical registry for current API task paths.
- [x] Add a local atomic-file persistence adapter and restart hydration.
- [x] Add recovery behavior that marks in-flight tasks interrupted without blindly repeating side effects.
- [x] Add focused persistence/restart tests.
- [ ] Add append-only event history, leases, idempotency, retry/backoff, cancellation propagation, and concurrency controls.
- [ ] Add duplicate-submission, tenant-isolation, concurrent-claim, and non-retryable-side-effect tests.
- Route every task submission through the same runtime boundary.

### Phase C — one safe operator workflow

Use repository maintenance as the first end-to-end workflow: inspect a named repository, run allowlisted checks, summarize failures, propose a patch on a branch, run regression tests, and open a review PR. Do not automatically merge or deploy.

Acceptance criteria:
- a task survives a process restart and resumes from recorded state;
- each step has input/output/error and timestamps in an audit trail, with secrets redacted;
- time, turn, concurrency, and spend budgets are enforced;
- failed checks cannot be reported as successful;
- repeated delivery does not repeat a non-idempotent action;
- unauthorized tools are denied at execution time;
- the task can be cancelled and leaves a terminal record;
- the workflow can run for 24 hours without unbounded task growth or duplicate scheduling.

### Phase D — deploy and observe

- Add authenticated operator status, health/readiness, structured logs, metrics, and alerts.
- Use a non-root service account, SSH key-based access, host firewall, private secrets, dependency updates, and backups with a tested restore.
- Add graceful SIGTERM shutdown and ensure active work is checkpointed or safely released.
- Set explicit model/API and infrastructure budget ceilings with alerts.
- Run fault-injection tests: model timeout, tool timeout, database unavailable, worker crash, restart during execution, duplicate events, and invalid tool output.
- Verify the deployed commit and record test output before enabling scheduled unattended work.

### Phase E — expand permissions gradually

Only after the previous workflow meets its acceptance criteria, add a new skill or domain adapter at a time. Begin marketing with research, draft generation, lead-list preparation from permitted sources, and campaign analytics. Require approval for external messaging, public publishing, customer commitments, spending, and production changes until each workflow has its own passing safety and reliability tests.

## Go/no-go gate

Do not call the operator production-ready until all of the following are evidenced on the same commit:

- unit, integration, type, lint, architecture, and security checks pass;
- restart/recovery and duplicate-action tests pass;
- task and tenant authorization tests pass;
- budget and timeout enforcement tests pass;
- backups restore successfully;
- 24-hour unattended test has no lost tasks, uncontrolled retries, or unexplained side effects;
- the deployed build is the tested commit and health/readiness checks pass.

## Operational metrics

Track task completion rate, verified success rate, human intervention rate, recovery rate, duplicate side effects, median/p95 task duration, model/tool cost per verified task, and business outcomes attributable to each workflow. Increase autonomy only when these metrics improve without a rise in harmful or unexplained actions.

## Related references

- [Node.js process and signal lifecycle](https://nodejs.org/api/process.html)
- [Express health checks and graceful shutdown](https://expressjs.com/en/advanced/healthcheck-graceful-shutdown/)
- [Durable workflow execution concepts](https://conductor-oss.github.io/conductor/devguide/architecture/durable-execution.html)
