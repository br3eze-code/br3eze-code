# AgentOS Commercial, Domain-Agnostic Platform Roadmap

## Architecture contract

The core owns runtime lifecycle, tool authorization, tenant scope, provider routing contracts, and audit events. Networking, payments, messaging, databases, MCP servers, and UI frameworks are integrations registered through explicit ports or plugins.

## Current implementation slice

- `src/adapters/mcp-client.js`: optional MCP client for stdio, SSE, and Streamable HTTP. It is dynamically loaded and does not force MCP SDK imports on core startup.
- `src/core/model-output.js`: strips raw `<think>` blocks. It intentionally does not persist or expose private chain-of-thought; provider-supported, user-safe reasoning summaries may be handled separately.
- `src/skills/loader.js`: reads YAML and SKILL.md front matter as metadata only. It does not execute third-party skill code.
- HITL approval lifecycle and delegated-tool factory are in `src/core/approval-gates.js` and `src/core/delegation.js` on the preceding feature branch.

## Security requirements before production

1. Treat MCP server configuration as administrator-controlled; never launch a command or URL selected directly by an end user.
2. Apply per-server tool allowlists, tenant authorization, schema validation, timeouts, output limits, and secret redaction before enabling remote tools.
3. Run untrusted skill code only in an isolated sandbox (container/WASM) with filesystem, network, CPU, memory, and wall-clock restrictions. Manifest parsing is not sandboxing.
4. Require durable atomic state transitions for approval decisions and execution claims.
5. Keep tenant identity server-derived; never trust tenant IDs supplied only in model-generated arguments.
6. Meter usage on the server and use durable idempotency keys for payment and credit mutations.
7. Stream only user-visible output, tool status, and provider-authorized summaries. Do not expose private chain-of-thought.

## Remaining roadmap

- Register MCP and skill-loader adapters through the canonical ToolRegistry / AgentRuntime composition root.
- Move networking and voucher implementations to separately installable plugins without breaking compatibility exports.
- Add plugin-provided CLI command registration.
- Add gateway streaming events, cancellation/backpressure, artifact schemas, and tenant-scoped quotas.
- Add integration tests for MCP disconnects, malicious manifests, cross-tenant calls, approval replay, and usage idempotency.
- Run unit tests, type/build checks, security audit, and architecture gates before merge.


## API and MCP integration catalog (planned targets, not current implementation counts)

AgentOS should support an open-ended catalog. Keep provider-specific SDKs and credentials inside optional adapters; the runtime depends only on stable ports and normalized contracts.

### Suggested first catalog: 30–50 API/provider adapters

| Capability family | Candidate providers / protocols | Integration rule |
| --- | --- | --- |
| Model inference | OpenAI, Anthropic, Google Gemini/Vertex AI, DeepSeek, OpenAI-compatible endpoints, Ollama, vLLM | Normalize streaming, tool calls, cancellation, usage, and errors behind one model-provider port. |
| Data and persistence | SQLite, PostgreSQL, Supabase, Firebase/Firestore, Redis, S3-compatible object storage | Core uses persistence/database ports; adapters declare durability and transaction capabilities. |
| Search and retrieval | provider-neutral web search, browser automation, vector stores, embeddings, rerankers | Explicit data-source permissions, citations/provenance, and tenant filters. |
| Messaging and notifications | Telegram, WhatsApp/Baileys, Slack, Discord, email, SMS | Normalize delivery status, retries, rate limits, and webhook verification. |
| Payments and commerce | Stripe, PayNow, EcoCash (where supported), PayPal, payment-provider webhooks | Server-side verification, idempotency, currency handling, refunds, and tenant-scoped ledgers. |
| Identity and access | OAuth/OIDC, Google identity, JWT integrations, organization/SCIM providers | Resolve identity server-side; enforce tenant, role, and capability policies in core. |
| Developer platforms | GitHub, GitLab, issue trackers, CI/CD providers | Least-privilege tokens; approval for writes, releases, and destructive actions. |
| Infrastructure and observability | AWS, Google Cloud, Kubernetes, Prometheus/OpenTelemetry, logging providers | Explicit capability scopes, bounded operations, redacted telemetry, and audit events. |
| Domain plugin suite | MikroTik/RouterOS, Wi-Fi vouchers, printers, POS, inventory, CRM | Optional plugins only; no domain-specific imports or environment requirements in core. |

The table is a discovery shortlist, not a claim that each provider is already implemented, compatible, or available in every region. Build a provider only when its contract, tests, credential handling, and operational limits are defined.

### Suggested first curated MCP catalog: 15–25 server integrations

Start with categories, then select maintained servers according to licensing, trust, support, and threat model: filesystem (sandboxed), GitHub, GitLab, issue tracking, documentation/search, browser automation, database read-only access, PostgreSQL, SQLite, object storage, Slack, Discord, Google Drive, calendar, email, observability, cloud infrastructure, Kubernetes, memory/retrieval, and local developer tools.

MCP server count is not the same as tool count. Each server may publish many tools; discovery does not imply authorization. Use the same canonical ToolRegistry and AgentRuntime for local and remote tools.

### Required MCP lifecycle and safety contract

1. Operator-controlled server configuration; never allow a prompt or tenant to choose arbitrary stdio commands, environment variables, or remote URLs.
2. Allowlisted transports (stdio, Server-Sent Events where supported, and Streamable HTTP), with transport/version compatibility tests.
3. Authenticate and authorize both tool discovery and every invocation using server-derived tenant and user context.
4. Prefix tool names with a stable server namespace; validate input and output schemas, bound response sizes, apply timeouts, and redact secrets.
5. Remote tools are high-risk and approval-required by default. Only a reviewed per-tool policy may reduce risk.
6. Handle reconnects, cancellation, process shutdown, rate limits, server errors, and tool schema changes explicitly.
7. Register and unregister tools through the canonical ToolRegistry; no parallel MCP execution engine.
8. Test cross-tenant denial, malicious tool descriptions, malformed schemas, output floods, transport disconnects, approval replay, and shutdown cleanup.

### Historical pattern recovery ledger

Do not merge historical branches wholesale. For every candidate PR, compare its patch against current `main` and the consolidation branch, then record: (a) unique behavior, (b) current equivalent or missing file, (c) tests proving behavior, (d) security/compatibility implications, (e) ported commit or reason rejected. Treat similar PR titles and commit counts as hints, not evidence of absorption.

Initial priority queue from the existing PR inventory:
- Runtime/workgraph execution and parity: #181, #123.
- Framework/protocol adapters and custom plugin safety: #124, #119.
- Commerce/datastore and ACP contracts: #128, #174.
- Authentication handoff: #182.
- Selective conflict repair/consolidation: #193.
- Organisation matrix/WBS control plane: #125, compared with later work such as #137.
- Partner-platform hardening overlaps: #135, #184.
- Payment integration/cleanup overlaps: #140, #141, #142, #144, #146.
- Dependency and mail security history: #196, #197, checked against current lockfile and audit output.
- Recent recovery and single-runtime work: #200, #207, #208, #209.

This is a prioritized reconciliation queue, not proof that every PR from #1 onward has been fully reviewed. Mark each PR only after patch-level comparison; deduplicate patterns before porting, and never claim full recovery while entries remain unchecked.

### Delivery order

1. Establish baseline results on `main` and the consolidation branch; classify existing failures versus regressions.
2. Fix canonical runtime contracts and production tool interception; wire MCP registration through the composition root.
3. Repair production voucher regression and failing test suites without weakening assertions.
4. Make package/lockfile and security-audit changes deliberately, with compatibility and license checks.
5. Extract networking and commerce as optional plugins, preserving compatibility shims during migration.
6. Add tenant-scoped streaming, cancellation/backpressure, artifacts, metering, and quotas.
7. Port historical patterns in small, tested commits; rerun full tests, build/type checks, architecture gates, and security checks before merge.


### Verified historical-pattern checkpoint (2026-10-26)

Status definitions: **present on main** means the named implementation file was checked on the current default branch; it does not mean every behavior or test from the historical PR has been proven equivalent. **Patch unavailable** means the PR endpoint did not return changed-file patches, so source-branch descriptions are evidence for investigation only.

| PR | Pattern | Current evidence | Next action |
| --- | --- | --- | --- |
| #123 | Runtime evaluation, trajectory replay, declarative workflows, usage metering, framework contract | The five implementation modules and runtime index exist on `main`; these are not wholesale missing features. | Compare behavior and tests against the historical patch; preserve improvements only if a concrete gap is found. |
| #124 | Framework adapters plus MCP/A2A protocol wrappers | Framework adapter, optional loaders, MCP adapter, A2A adapter and tests exist on `main`. | Audit authorization defaults, actual framework API compatibility, and whether adapters are wired into composition. |
| #119 | WBS-based custom-plugin safety and native capability handling | `custom-plugins/wbs-agents/index.mjs` exists on `main`. | Compare safety behavior, Cordova compatibility and tests; do not restore removed native features that were replaced with unsupported stubs without proving the implementation works. |
| #181 | WorkGraph-backed canonical runtime, execution records, verification | PR is closed unmerged and its current PR patch endpoint returns no changed files. | Audit current `src/core/agentRuntime.js`, WorkGraph, ExecutionRecord and VerificationEngine directly; recover only demonstrably missing behavior. |
| #209 | Persisted HITL, delegation, MCP registration and skill metadata | Implemented on the consolidation branch; still under review and not merged. | Keep targeted tests passing and resolve full-suite/deployment failures before merge. |

### Current implementation hardening

The approval workflow now uses conditional `EXECUTING -> EXECUTED/FAILED` transitions instead of unconditional terminal writes. This prevents a worker from overwriting a state changed by another actor. If execution has already happened but the terminal compare-and-set fails, the workflow reports that manual reconciliation is required rather than silently claiming a consistent state. A regression test covers failed execution finalization and replay denial.

### Port-and-adapter corrections in progress (2026-10-26)

- Added `src/core/ports/system.js`, a provider-neutral system capability port. It requires a logical target, reason, explicit tenant/user context, authorization, approval, and a host-supplied adapter resolver before delegating a reboot. Tests cover ordering, denial, invalid inputs, and missing identity.
- Added the canonical RouterOS-specific tool name `mikrotik.system.reboot`; the old unqualified `system.reboot` entry in `src/tools/tool.js` remains a deprecated compatibility alias only. This is a migration step, not proof that every production call site now uses the new port.
- Made the Supabase auth SDK lazy-loaded in `src/adapters/auth/supabase.js` so unrelated AgentOS deployments/tests do not require the Supabase SDK merely to import the adapter. A configured Supabase deployment still needs that package installed; the missing dependency must be resolved in packaging or documented as an optional extra.
- Corrected the architecture isolation test's invalid `node:assert` import.

**Still required before these are considered complete:** wire the system port into the production composition root and canonical ToolRegistry; migrate production RouterOS reboot callers; establish a default-neutral boot profile without silently breaking existing network deployments; reconcile the legacy AskEngine ReAct path with AgentRuntime; and verify the latest CI runs.

### CI state rule

A queued or running workflow is not a pass. The current PR head must pass the targeted tests, full suite, build/syntax and architecture gates, security checks, and deployment regression tests. Existing failures must be baselined against `main`; no test may be skipped or weakened just to turn the badge green.

### Objective-by-objective delivery status (2026-10-26)

This ledger separates code present on the feature branch from behavior proven in a deployed, production-wired path.

| Original objective | Current evidence | Status |
| --- | --- | --- |
| One canonical execution owner (AgentRuntime / AgentLoop) | Runtime and loop exist; gateway uses runtime in at least one composition path, but legacy ask-engine.js still contains a separate ReAct implementation and domain tools. | **Partial** — finish call-site migration and prove no competing production loop. |
| Domain-neutral core with ports/adapters | Model, system, persistence, notification, and framework contracts exist; default boot remains network; system port is not wired into the production composition root. | **Partial** — neutral default and composition-root wiring remain. |
| Port useful behavior file-by-file from historical branches | Selected patterns and an initial PR checkpoint are recorded; the recovery ledger is a priority queue, not a complete audit of all historical PRs. | **In progress** — compare patches, tests, and current main for every candidate before marking absorbed. |
| Preserve compatibility while deleting duplicates | Compatibility shims exist, but competing engine and domain declarations remain. | **Partial** — migrate callers first, then delete only verified superseded code. |
| General-purpose agent lifecycle | Registry has create/remove methods; framework contract exposes create/run/remove; a provider-neutral lifecycle port now defines authorization, approval, and runtime delegation. | **Partial** — port is not wired to production ToolRegistry/runtime composition; registry persistence and tenant isolation need a production adapter. |
| HITL/delegation and MCP/skill safety | Approval/delegation and MCP/manifest modules plus targeted tests exist on this branch. Roadmap explicitly says MCP and skill loading are not wired into production composition and skills are metadata-only. | **Partial** — wire adapters and prove end-to-end authorization/sandboxing. |
| Full tests/build/security/deployment green | PR description records full-suite failures, Vercel voucher regression, and npm audit findings from the previous observed run. | **Not complete** — re-run on the current head and compare against main baseline. |
| Ship verified work to main | PR #209 remains a draft and has not been merged. | **Not shipped to main** — branch commits are not equivalent to a main-branch release. |

### Additional first-class capability families

Keep these capabilities provider-neutral and route all execution through the same runtime and ToolRegistry. They are capability contracts, not claims that each handler is already implemented.

- **Agent lifecycle:** agent.create, agent.run, agent.remove, agent.status, agent.list, agent.pause, agent.resume.
- **Execution lifecycle:** execution.status, execution.cancel, execution.resume, execution.verify, execution.replay.
- **Session and memory:** session.create, session.resume, session.close, memory.search, memory.read, memory.write.
- **Workflow and task orchestration:** workflow.define, workflow.run, workflow.resume, workflow.cancel, task.create, task.status, task.cancel.
- **Governance and observability:** approval.request, approval.status, capability.discover, audit.query, trace.read, evaluation.run.
- **Integration lifecycle:** provider.list, provider.health, plugin.install, plugin.enable, plugin.disable, plugin.remove.

For every capability, require a versioned schema, server-derived tenant/user context, policy checks, audit events, bounded execution, and a test of denial paths. Destructive or externally consequential operations require approval and idempotency where appropriate. Do not add names to the public manifest until the runtime can either execute them through a registered handler or return an explicit unsupported-capability error.

### First-class agent and reporting capabilities (2026-10-26)

- `agent.get` and `agent.call` are now exposed by the provider-neutral `src/core/ports/agent-lifecycle.js` port. Both require server-derived tenant/user context and authorization; `agent.call` delegates to the host-injected canonical runtime executor rather than starting another loop.
- `report` is now defined by `src/core/ports/report.js`. It emits a versioned structured report from an injected trusted data source, including provenance, record count, optional source summary/warnings, and generation time. It does not invent missing metrics.
- Focused tests were added for authorized lookup, runtime delegation, report source validation, and denial paths.
- These are **first-class port contracts, not yet production-wired public capabilities**. Before exposing them in the public tool manifest, wire tenant-scoped registry/storage and report query adapters into the composition root, enforce object-level tenant isolation on reads, and add end-to-end ToolRegistry/AgentRuntime tests. Do not claim durable multi-tenant agent storage from the current in-memory registry.

