# AgentOS Matrix Organization Architecture

**Status:** Proposed architecture baseline
**Author:** Manus AI
**Scope:** Domain-agnostic AgentOS control plane, multi-tenant fleet operations, cross-platform channels, specialist teams, and repository governance.

## Executive position

AgentOS should not be organized as one hierarchy of agents, one chatbot per domain, or one router-specific command tree. The audited repositories show a stronger pattern: a **matrix organization** in which each execution is resolved across independent dimensions. A request is therefore addressed by its identity and scope, business domain, specialist role, capability, resource target, channel surface, workload class, and evidence contract.

This preserves the existing AgentOS strengths—tenant-scoped mesh management, specialist runtime contracts, WBS-linked work, Telegram and WhatsApp access, router adapters, durable state, and audit controls—while allowing patterns from the companion repositories to be reused without turning them into hard dependencies.

> **Canonical rule:** channels render work; specialists own work; adapters reach resources; policy authorizes work; durable state proves work.

## Repository evidence and reusable patterns

| Repository | Observed architectural value | Reuse boundary in AgentOS |
|---|---|---|
| [`br3eze-code`](https://github.com/br3eze-code/br3eze-code) | Production-oriented AgentOS codebase with mesh management, tenant/RLS boundaries, Telegram and WhatsApp channels, specialist runtime, payments, WBS, Cordova, PHP fallbacks, and CI security gates. | System of record for the control plane. New matrix contracts belong here. |
| [`AgentOS`](https://github.com/br3eze-code/AgentOS) | Compact network-agent reference with `AgentMemory`, `NodeRegistry`, `SkillRegistry`, `HookRegistry`, Telegram/WhatsApp/REST/WebSocket surfaces, MikroTik manager, and Sentinel. | Reference for minimal bootstrapping and local edge mode; do not duplicate production services. |
| [`openclaw`](https://github.com/br3eze-code/openclaw) | Gateway-centered architecture for sessions, tools, events, channels, plugins, skills, control UI, CLI/TUI, companion apps, and nodes. | Reuse the gateway/session/channel separation and plugin boundary as an architectural pattern. |
| [`gemini-cli`](https://github.com/br3eze-code/gemini-cli) | Terminal-first agent with built-in tools, MCP extensions, checkpointing, context files, non-interactive automation, and multiple auth modes. | Reuse checkpoint/context and MCP capability patterns; keep authorization in AgentOS policy rather than the model client. |
| [`hermes-agent`](https://github.com/br3eze-code/hermes-agent) | Cross-platform personal-agent orientation with UI/TUI and messaging bridge signals. | Reference for platform packaging and message-bridge isolation. |
| [`skills-directory`](https://github.com/br3eze-code/skills-directory) | Searchable skill catalog model with owner, use case, responsibilities, collaborators, dependencies, and routing boundary. | Seed the canonical skill registry and specialist directory metadata. |
| [`SpaceX-API`](https://github.com/br3eze-code/SpaceX-API) | Clear resource-model API with routes, models, pagination, authentication, caching, jobs, and tests. | Reference for provider-neutral resource adapters and read-heavy fleet query APIs. |
| [`vscode`](https://github.com/br3eze-code/vscode) | Large extension and workbench ecosystem. | Reference only for extension contribution boundaries; never import its repository-scale complexity into AgentOS core. |
| [`formula-chat`](https://github.com/br3eze-code/formula-chat) | Split API/frontend/container deployment pattern. | Reference for separating web presentation from API services. |
| [`video-editing-agent`](https://github.com/br3eze-code/video-editing-agent) | Small domain-focused Python agent. | Reference for domain package isolation and media-task handoff. |
| [`nanochat`](https://github.com/br3eze-code/nanochat) | Small model-serving/training project with tests and scripts. | Reference for bounded model-runtime experiments, not control-plane authorization. |
| [`nanoGPT`](https://github.com/br3eze-code/nanoGPT) | Minimal training and sampling loop. | Reference for model experimentation only. |
| [`llm.c`](https://github.com/br3eze-code/llm.c) | Low-level C/CUDA training runtime with scripts and profiling. | Reference for optional high-performance model workers; keep outside the tenant control plane. |

The distinction is important. **AgentOS is the control plane**, while model-training repositories are compute sources, gateway repositories are interaction references, and domain repositories are adapter candidates. Matrix organization prevents every repository from becoming a competing source of truth.

## Matrix 1: organizational responsibility

The primary matrix is role by responsibility. Rows are accountable organizational cells; columns are lifecycle responsibilities. A cell may be executed by a human, specialist agent, or approved service, but its ownership and approval boundary remain stable.

| Cell | Owns | Reads | Proposes | Executes only with approval | Produces evidence |
|---|---|---|---|---|---|
| Project Manager | Portfolio, WBS, dependencies, critical path, decisions | All project summaries | Replans and delegations | Scope, schedule, budget mutations | WBS, milestone, decision, closeout |
| Planner | Objectives, packages, milestones, acceptance criteria | Requirements and constraints | Plans and dependencies | Approved plan mutations | Plan activity and dependency graph |
| Engineer | Diagnostics, implementation, integration, rollback | Code, device health, platform baselines | Technical changes | Code/config/device/deploy actions | Test logs, change record, rollback status |
| Designer | Requirements, flows, prototypes, design systems | User and service context | Designs and reviews | Publication of shared assets | Design package and review findings |
| Draftsman | Controlled diagrams, specifications, revisions | Approved source material | Drafts and revisions | Document issue/publication | Revision and issue record |
| Accountant | Period, currency, cost, variance, settlement | Orders, payments, commitments | Reconciliation and forecasts | Ledger/payment/settlement mutations | Financial proof and reconciliation |
| Procurement | Suppliers, quotes, buy/make, purchase proposals | Catalog, inventory, budgets, technical criteria | Supplier and purchase options | Purchase/supplier/budget commitments | Quote comparison and approval evidence |
| Expeditor | Shipment milestones, tracking, delay recovery | Orders, provider events, supplier commitments | Exception and recovery options | Shipment/vendor/notification mutations | Tracking proof and closure |
| Secretary | Stakeholders, communications, meetings, records | Activities, decisions, approvals | Drafts, agendas, follow-ups | Sends/commits only with permission | Distribution and decision record |
| QA | Acceptance, regression, defects, commissioning | Tests, evidence, requirements | Release recommendations | Commissioning/release gate | Acceptance report and defect ledger |
| Security | Tenant isolation, identities, secrets, vulnerability posture | Policies, audit, dependencies | Remediation and access changes | Security configuration or emergency containment | Security evidence and exception record |
| Fleet Operations | Polling policies, adapter health, site/node events | Mesh topology, node snapshots, leases | Polling plans and alert grouping | Router mutation only through Engineer policy | Poll run, node snapshot, event aggregate |

The **Fleet Operations** cell is an operational capability, not a replacement for Engineer or Project Manager. It may read health at high frequency, but it cannot silently convert a health observation into a device mutation.

## Matrix 2: domain and capability

Domains must be data labels and policy scopes, not separate hard-coded agent universes. Every specialist capability is registered as a tuple:

```text
(domain, capability, role, resource-kind, approval-class, evidence-kind)
```

| Domain family | Example capabilities | Resource kinds | Primary specialist cells |
|---|---|---|---|
| Network and fleet | health.read, users.read, topology.read, router.configure, user.suspend | tenant, mesh, site, node, session | Fleet Operations, Engineer, Security |
| Connectivity and roaming | access.resolve, voucher.redeem, roaming.attach, session.revoke | principal, site, node, access-session | Fleet Operations, Engineer, Secretary |
| CCTV and IoT | camera.health.read, stream.redact, device.provision | site, camera, gateway, stream | Engineer, Security, QA |
| Commerce and POS | catalog.read, order.read, payment.reconcile, settlement.propose | product, order, transaction, wallet | Catalog, Accountant, Procurement |
| Fulfillment | shipment.read, exception.propose, milestone.update | order, shipment, vendor, milestone | Expeditor, Procurement |
| Project delivery | wbs.read, package.create, dependency.update, closeout | project, wbs, activity, decision | Project Manager, Planner, QA |
| Media and communications | brief.create, render.request, message.draft, publish | asset, brief, channel, recipient | Designer, Draftsman, Secretary |
| Model and research | search.ground, context.build, classification.run | source, research-task, model-run | Planner, Engineer, Draftsman |

A domain adapter may add capabilities, but it may not bypass the common identity, tenant, resource, approval, idempotency, and evidence contracts.

## Matrix 3: resource and context hierarchy

Every channel request resolves to a durable scope object. The scope is narrower than the identity and is never inferred only from a natural-language phrase.

```text
principal
  └── tenant membership(s)
        └── project(s)
              └── mesh group(s)
                    └── site(s)
                          └── node(s)
                                └── user/session(s)
```

The canonical context object is:

```json
{
  "principalId": "principal-123",
  "channel": "telegram",
  "channelAccountId": "telegram-bot-prod",
  "conversationId": "telegram-chat-456",
  "tenantId": "tenant-001",
  "projectId": "project-001",
  "meshGroupId": "mesh-001",
  "siteIds": ["site-nairobi", "site-kisumu"],
  "nodeIds": ["node-rtr-01", "node-rtr-02"],
  "roamingSessionId": "roam-789",
  "role": "operator",
  "capabilities": ["health.read", "users.read"],
  "source": "explicit-selection",
  "expiresAt": "2026-08-17T12:00:00.000Z",
  "traceId": "trace-abc"
}
```

A roaming user may have access to several sites or tenants, but the channel must show the active selection and require explicit switching. It must not merge identities across tenants or expose actions performed at an unselected site.

## Matrix 4: channel and presentation parity

Channels are a presentation and transport layer. They call the same context factory, policy engine, specialist runtime, fleet query API, and durable task state.

| Surface | Best use | Required context behavior | Output renderer | Mutation rule |
|---|---|---|---|---|
| Telegram | Fast operational queries and approvals | Persist chat-to-principal mapping and expiring active scope; inline site/tenant selectors | Compact summaries, keyboards, paginated lists | Callback revalidates identity and scope |
| WhatsApp | Field operations and notifications | Bind phone identity, conversation, tenant, and active site | Numbered menus and short messages | Same approval service as Telegram |
| PWA/Web | Fleet maps, trends, bulk review | Browser session plus explicit tenant/project/site filters | Tables, graphs, topology, event timeline | Server-side authorization on every request |
| CLI/TUI | Engineering and scripted operations | Local identity plus explicit environment and scope flags | Structured text/JSON, trace IDs | No implicit default device in multi-tenant mode |
| Desktop/Mobile | Offline-capable operator workflows | Device-bound session with replay-safe sync | Native views and local queue state | Mutations queue with approval and conflict checks |
| Router edge agent | Low-latency local observation | Node identity and signed enrollment | Metrics/events only | Device mutation requires signed control-plane instruction |
| REST/WebSocket/SSE | Programmatic integration and live updates | Authenticated token and tenant/resource filters | JSON, SSE events, schema version | Rate-limit and scope-check at the API boundary |

## Matrix 5: execution and hosting

High-frequency deterministic health polling must bypass CLI intents and model loops. The model may explain results or propose a response, but it should not be on the critical path of a 1000-router health check.

| Workload | Execution path | State | Model involvement | Failure isolation |
|---|---|---|---|---|
| Router health poll | Fleet Poller → adapter pool → snapshot store | Durable lease, cursor, snapshot | None required | Per-node timeout and retry budget |
| Site health aggregate | Aggregator → site state/event store | Windowed event state | Optional summarization after aggregation | Per-site bucket |
| Telegram `/health` | Channel → context factory → fleet query API | Read-only query and trace | Optional natural-language formatting | Per-request budget |
| Fleet alert | Aggregator → notification policy → channel renderer | Deduplication key and cooldown | Optional classification | Per-tenant notification budget |
| Device mutation | Channel → specialist runtime → policy/approval → adapter | Idempotency and audit | Optional proposal | Per-action approval and rollback |
| WBS task | Scheduler/queue → specialist activity | Durable task state | Required only if task needs judgment | Per-activity retry and dead-letter state |

For the target of 1000+ routers, the default deployment should be a continuously running managed backend process with a durable database and cache. A cloud computer is justified only when fixed IP, custom OS packages, Docker, or resource requirements exceed the managed hosting ceiling. The polling service must remain independently restartable from the Telegram process.

## Matrix 6: evidence and governance

Every meaningful operation produces a common evidence tuple:

```text
traceId + activityNumber + tenantId + projectId + siteId(s) + nodeId(s)
+ capability + actor + channel + approvalId + idempotencyKey
+ startedAt + finishedAt + outcome + evidenceRefs
```

| Event class | Stored record | Minimum retention fields | Customer-safe rendering |
|---|---|---|---|
| Observation | Node health snapshot | node, site, tenant, timestamp, adapter, status, latency, redacted error | Status, last seen, impact, next check |
| Aggregate | Site/fleet health window | scope, window, counts, dominant state, representative causes | One summary instead of one alert per node |
| Access resolution | Roaming context decision | principal, tenant, site, policy, source, expiry, trace | Active scope and expiry |
| Proposal | Specialist action proposal | role, capability, scope, criteria, risks | What will happen and what approval is needed |
| Mutation | Approved device or business action | approval, idempotency, adapter result, rollback | Verified result only |
| Handoff | WBS/package transfer | source/receiver activities, dependencies, decision required | Current owner and next action |

## Recommended organizational model

Use a **three-axis matrix** rather than a conventional agent hierarchy:

1. **Accountability axis:** Project Manager, Planner, Engineer, Accountant, Secretary, Procurement, Expeditor, Designer, Draftsman, QA, Security, and Fleet Operations.
2. **Capability axis:** domain-neutral capabilities such as `health.read`, `context.resolve`, `proposal.create`, `device.mutation`, `document.issue`, and `settlement.reconcile`.
3. **Resource axis:** tenant, project, mesh group, site, node, user, session, order, asset, or activity.

The runtime resolves the intersection. For example:

```text
Fleet Operations × health.read × tenant-001/project-001/site-kisumu/node-rtr-07
Engineer × device.mutation × tenant-001/site-kisumu/node-rtr-07
Secretary × message.send × tenant-001/project-001/channel-telegram
Accountant × settlement.reconcile × tenant-002/order-1042
```

This gives AgentOS a stable operating model across network, CCTV, commerce, logistics, media, and future domains. Domains add resource adapters and skill packages; they do not create alternate authorization systems.

## Implementation status and next sequence

The first matrix package is now implemented in the production repository. `docs/agentos-matrix-organization.json` is the machine-readable registry; `src/core/agent-matrix-registry.js` resolves accountability, capability, channel, resource, and approval intersections; `src/core/roaming-context.js` resolves explicit multi-tenant, multi-site, and multi-router selections with expiry and authorization checks; and `src/core/fleet-health-poller.js` provides deterministic bounded-concurrency polling with per-node leases, timeouts, snapshot hooks, and site-level aggregation. The existing mesh CRUD and SSE boundaries remain the source of truth for topology and live delivery.

The attached unified Phases 1–5 research is now ported through the shared control-plane seams. `ApprovalGate` has durable-store hooks, expiry, action/scope binding, and idempotent request reuse. `ResourceGovernance` implements tenant/site-scoped `AVAILABLE → RESERVED → COMMITTED → CONSUMED` transitions with capacity checks and evidence. `AuditLogger` accepts structured tenant/site/principal/channel/work/loop/execution/resource correlation fields. `LoopEngine` now supports bounded `WAIT`/resume behavior and a `maxCost` budget. `AgentOS.buildContext`, Telegram, WhatsApp, and the legacy Telegram mesh adapter use the roaming-aware context contract; no channel receives authority merely from possessing a tool.

The next integration sequence is to connect the poller’s `listTargets`, `pollTarget`, and snapshot hooks to the durable mesh/node health store; add retry budgets and dead-letter handling; expose read-only fleet query operations through SpecialistRuntime; and complete the onboarding/device-fingerprint/Power Connect end-to-end adapters. These remain separate from the kernel: MikroTik is an adapter, Power Connect is an operational consumer, and AWS or persistent hosting supplies runtime infrastructure rather than authorization logic.

The acceptance gate is a cross-channel proof that the same principal receives the same tenant/site/node scope, the same activity and trace identifiers, the same approval state, and the same redacted result on Telegram, WhatsApp, PWA, CLI, desktop, and mobile. Current focused validation covers 9 suites and 35 tests across matrix resolution, roaming context, AgentOS/channel context, fleet polling, loop governance, approvals, resource governance, audit evidence, and Phase 3 orchestration. Full end-to-end onboarding, device fingerprint quarantine, Power Connect handoff, and all-surface parity are intentionally tracked as remaining integration work rather than represented as complete.

## References

1. [br3eze-code/br3eze-code](https://github.com/br3eze-code/br3eze-code)
2. [br3eze-code/AgentOS](https://github.com/br3eze-code/AgentOS)
3. [br3eze-code/openclaw](https://github.com/br3eze-code/openclaw)
4. [br3eze-code/gemini-cli](https://github.com/br3eze-code/gemini-cli)
5. [br3eze-code/hermes-agent](https://github.com/br3eze-code/hermes-agent)
6. [br3eze-code/skills-directory](https://github.com/br3eze-code/skills-directory)
7. [br3eze-code/SpaceX-API](https://github.com/br3eze-code/SpaceX-API)
8. [br3eze-code/vscode](https://github.com/br3eze-code/vscode)
9. [br3eze-code/formula-chat](https://github.com/br3eze-code/formula-chat)
10. [br3eze-code/video-editing-agent](https://github.com/br3eze-code/video-editing-agent)
11. [br3eze-code/nanochat](https://github.com/br3eze-code/nanochat)
12. [br3eze-code/nanoGPT](https://github.com/br3eze-code/nanoGPT)
13. [br3eze-code/llm.c](https://github.com/br3eze-code/llm.c)
