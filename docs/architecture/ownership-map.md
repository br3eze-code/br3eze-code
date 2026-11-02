# AgentOS ownership map

This document records the canonical owner for each cross-cutting concern. Compatibility facades may preserve older imports, but must not reimplement state, policy, persistence, or execution.

## Canonical owners

| Concern | Canonical owner | Rules |
| --- | --- | --- |
| Agent execution and model/tool turns | `src/core/agentRuntime.js` | Only owner of agent turn execution. Hosts and harnesses obtain it through `getAgentRuntime()` unless a runtime is explicitly injected for isolation/testing. |
| Work-level plan/execute/observe/verify lifecycle | `src/core/orchestration/loop-engine.js` via `src/core/orchestration/orchestrator.js` | Runs a scoped work lifecycle; it does not create or own another AgentRuntime. |
| Periodic system maintenance | `src/core/orchestrator.js` (`SystemLifecycleCoordinator`) | Schedules host-supplied maintenance/observation callbacks only; it is not the work orchestrator. |
| Managed trusted-service lifecycle | `src/core/os/ServiceSupervisor.js` | Owns service state, dependencies, transition serialization, and reverse dependency shutdown. |
| Tenant-scoped in-process IPC | `src/core/os/IPCMessageBus.js` | Owns authorization, payload validation, tenant isolation, subscriptions, and audit callbacks. |
| Application-to-service registration | `src/core/os/ApplicationManager.js` | Declarative application metadata and delegation to the service supervisor; it does not run code or provide a sandbox. |
| Host-local durable key/value state | `src/adapters/persistence/local-state-store.js` | Owns Node filesystem access and tenant/application storage paths. |
| Session event semantics | `src/core/session/SessionEventStore.js` | One shared event stream owner for AgentRuntime, AgentKernel, and MemoryManager. |
| Local durable session events | `src/adapters/persistence/file-session-event-store.js` | JSONL append-only adapter; composed by the Node gateway and registered through the session-event-store port. |
| Platform provider SPI | `src/platform/provider-registry.js` and `provider-contracts.js` | Explicit provider registration and capability resolution; no implicit provider authority. |
| HTTP API backend | `server/` (Firebase Functions/standalone Express composition) | Owns backend domain routes and persistence integration. |
| Vercel HTTP API forwarding | `api/[...path].js` | Proxy only; it must use a separately configured HTTPS `AGENTOS_API_URL`, never the frontend origin. |

## Compatibility facades (not independent implementations)

- `src/platform/service-supervisor.js` adapts the legacy `register(id, service, options)` API to `src/core/os/ServiceSupervisor.js`.
- `src/platform/ipc-bus.js` adapts the legacy topic API to `src/core/os/IPCMessageBus.js`.
- `src/platform/local-state-store.js` re-exports the persistence adapter; it must not contain filesystem logic.
- `src/core/kernel/index.js` exports the work-level `AgentOSOrchestrator` and exposes the maintenance scheduler under the distinct name `SystemLifecycleCoordinator`.

## Boundary rules

1. Do not add another agent loop, task registry, service supervisor, IPC delivery engine, or filesystem state store.
2. Core orchestration receives model, tools, storage, hardware, and transport through ports/adapters; no provider SDK or host filesystem access belongs in the runtime.
3. SessionEventStore owns event semantics; runtime snapshots are appended to that stream. The file adapter is host persistence, not a second session manager.
4. A compatibility facade may translate signatures only. It must delegate behavior to its canonical owner and have contract tests.
5. A service supervisor manages trusted in-process services. It is not a process sandbox, container runtime, or security boundary.
6. A workload runner is an adapter for a workload execution strategy. It must not create a second agent execution loop; untrusted workloads require real OS/container isolation.
7. Keep Firebase Functions backend routes and the Vercel proxy distinct: the proxy forwards requests and must never contain a second copy of business logic.

## Verification

- `npm run test:platform`
- `npm run test:production`
- GitHub Actions CI, Level 2 Platform Foundation, Security, and Vercel Deployment must complete successfully on the same `main` SHA before production readiness is claimed.
