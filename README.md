# AgentOS

**Domain-neutral agent orchestration and execution platform.**

AgentOS provides a reusable control plane for agents, tools, skills, workflows, policies, execution context, memory, and adapters. Networking, commerce, payments, messaging, cloud providers, mobile clients, and protocol integrations are extensions of the platform—not the definition of its core.

## Architecture

```text
                         AgentOS
                            │
                          Kernel
                            │
                         Runtime
                            │
                         Engine
                            │
                  Capability / Port Layer
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
     Commerce            Network            Payments
     Adapter             Adapter             Adapter
        │                   │                   │
       ACP              RouterOS             Providers

 Host / Harness / Channels sit outside the execution core.
 They compose adapters, persistence and transports around the runtime.
```

### Core boundary

`src/core` contains generic orchestration primitives and ports only. Concrete persistence, network, commerce, payment, messaging and framework integrations belong behind adapters.

The repository includes a strict boundary gate:

```bash
npm run check:domain-boundary
```

It must pass before AgentOS can be considered fully domain-agnostic.

See `docs/domain-coupling-audit.md` and `docs/domain-agnostic-contract.md` for the contract and remaining migration debt.

## Execution architecture

The execution responsibilities are deliberately separated:

- **Kernel** — domain registration, resolution primitives, dispatch lifecycle and kernel events.
- **Runtime** — planning/context/policy/tool execution and agent lifecycle.
- **Engine** — model/turn execution and model-specific behavior.
- **Harness** — host/composition facade; wires domains, registries, persistence and channels. It is not a second execution engine.
- **Adapters** — concrete providers and external integrations.

Persistence is a port. `SessionStore` implementations such as SQLite and in-memory storage live under `src/adapters/persistence/`; the Kernel never constructs a database directly.

Domain resolution is fail-closed: an explicit domain or a unique domain/capability match may resolve automatically. Ambiguous or unmatched multi-domain intent is rejected with a stable resolution error so the planner/host can clarify rather than silently selecting the first registered domain.

## Runtime model

The execution model is:

```text
Receive → Understand → Plan → Execute → Observe → Evaluate
       → Handoff / Retry / Escalate → Verify → Complete
```

Execution is scoped with tenant/work/action context, while capability registration and policy/approval checks provide the control boundary for tools and adapters.

## Domain adapters

A domain adapter declares:

- `type`
- `version`
- capabilities and input schemas
- an `execute()` implementation

Adapters are registered through the domain/kernel boundary and invoked with scoped execution context.

This allows the same orchestration engine to operate on unrelated domains. A networking adapter, commerce adapter, or future library/warehouse/education adapter should not require changes to the core kernel.

## Commerce and agentic commerce

Commerce is an adapter/domain implementation, not a core primitive. The repository contains catalog, inventory, cart, order, invoice, transaction, shipment, tracking, and checkout functionality.

The Agentic Commerce Protocol (ACP) integration lives under `src/commerce/acp/` and is intentionally isolated from Core. Current ACP work is **internal protocol alignment and adapter preparation; it does not mean the repository is connected to ChatGPT, certified by OpenAI, or eligible for any external commerce program.**

The commerce engine, POS store, shopping agent, courier gateway/providers, invoice generation, and order notification are outside `src/core`. Network plan sales has also moved to `src/domains/network/plan-sales.js`; concrete hotspot provisioning is supplied by `src/adapters/network/hotspot-plan-provisioner.js` rather than embedded in the domain service.

## Multi-channel operation

Channels translate external messages into AgentOS execution frames. The same runtime boundary is used across supported channels; channel identifiers are not business-operation idempotency keys.

Domain logic should never depend on a particular channel.

## Framework isolation

AgentOS orchestration is native to the platform. LangChain, LangGraph, CrewAI and similar frameworks are integration adapters, not Core dependencies. Framework-specific helpers belong under `src/adapters/frameworks/` and may be replaced without changing kernel contracts.

## Repository layout

```text
src/
├── core/                 Domain-neutral kernel/runtime primitives and ports
├── domains/              Domain implementations (commerce, network, vision, ...)
├── adapters/             Concrete provider/channel/domain/framework integrations
├── commerce/             Commerce protocol boundary, including ACP
├── api/                  HTTP/API boundaries
├── channels/             External messaging/channel integrations
├── skills/               Agent capabilities and skill definitions
├── cli/                  CLI commands and host integration
└── ...                   Optional domain/integration modules

custom-plugins/           Client/platform plugins
apps/                     Client/shared applications
www/                      Web application
scripts/                  Build, migration, security and quality gates
tests/                    Automated tests
docs/                     Architecture and operational documentation
```

## Installation

Requirements:

- Node.js 22+
- npm

```bash
npm install
npm test
npm run build
npm run check:domain-boundary
```

Provider/domain credentials are supplied through the appropriate adapter configuration. Do not commit secrets.

## Quality gates

```bash
npm test
npm run lint
npm run build
npm run check:domain-boundary
npm run security:audit
```

The domain-boundary check is intentionally separate from the general build while the repository completes its legacy-module migration. A successful AgentOS release should eventually require the core-only installation and test suite to succeed with concrete domain adapters physically absent.

## Current migration status

AgentOS is in architectural consolidation. The Core ports are established, commerce has been extracted from `src/core`, network plan sales is separated behind a domain/provisioner boundary, framework-specific orchestration has moved out of Core, the Kernel no longer owns a database implementation, and domain resolution now fails closed on ambiguity.

Remaining priorities are:

1. consolidate Specialist ToolRegistry as a pure projection over the canonical registry;
2. complete canonical Subagent lifecycle: spawn, scope, permissions, budget/depth, handoff, persistence and termination;
3. finish AgentEngine/AgentRuntime responsibility boundaries and keep AgentHarness as a host facade;
4. extract the remaining network/provider compatibility shims from `src/core`;
5. add core-only install/test acceptance with concrete domains and providers absent;
6. unify identity/context/policy/audit enforcement across HTTP, WS, CLI, messaging and client boundaries;
7. complete ACP authenticated HTTP routes, payment-handler mapping, cancellation/refund semantics, and conformance tests;
8. run full CI/build/security verification and resolve any regressions before declaring the architecture production-ready.

## License

Apache-2.0
