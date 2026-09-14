# AgentOS

**Domain-neutral agent orchestration and execution platform.**

AgentOS provides a reusable control plane for agents, tools, skills, workflows, policies, execution context, memory, and adapters. Networking, commerce, payments, messaging, cloud providers, mobile clients, and protocol integrations are extensions of the platform—not the definition of its core.

## Architecture

```text
                         AgentOS
                            │
             ┌──────────────┴──────────────┐
             │                             │
        Core Kernel                    Agent Runtime
             │                             │
             └──────────────┬──────────────┘
                            │
                   Capability / Port Layer
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
     Commerce            Network            Payments
     Adapter             Adapter             Adapter
        │                   │                   │
       ACP              RouterOS            Providers
        │                / other             / A2A
        └───────────────────┴───────────────────┘

 Channels (Telegram / WhatsApp / Slack / Discord / Web / CLI)
 and clients are integration boundaries around the same runtime.
```

### Core boundary

`src/core` is intended to contain generic orchestration primitives only. The domain kernel defines generic entities such as organisations, principals, roles, capabilities, policies, workflows, resources, tools, work, loops, actions, evidence, outcomes, and audits.

Concrete domains belong behind adapters. The repository includes a boundary gate:

```bash
npm run check:domain-boundary
```

The gate is deliberately strict and is part of the migration toward a removable-domain architecture. It must pass before AgentOS can be considered fully domain-agnostic.

See [`docs/domain-coupling-audit.md`](docs/domain-coupling-audit.md) and [`docs/domain-agnostic-contract.md`](docs/domain-agnostic-contract.md) for the current contract and known migration debt.

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

Adapters are registered through `src/core/domain-kernel.js` and are invoked only with a scoped execution context.

This allows the same orchestration engine to operate on unrelated domains. A networking adapter, commerce adapter, or a future library/warehouse/education adapter should not require changes to the core kernel.

## Commerce and agentic commerce

Commerce is an adapter/domain implementation, not a core primitive. The repository contains catalog, inventory, cart, order, invoice, transaction, shipment, tracking, and checkout functionality.

The Agentic Commerce Protocol (ACP) integration lives under `src/commerce/acp/` and is intentionally isolated from the core. Current ACP work is **internal protocol alignment and adapter preparation; it does not mean the repository is connected to ChatGPT, certified by OpenAI, or eligible for any external commerce program.**

## Multi-channel operation

Channels translate external messages into AgentOS execution frames. The same agent/runtime boundary is used across supported channels; channel identifiers are not business-operation idempotency keys.

Domain logic should never depend on a particular channel.

## Repository layout

```text
src/
├── core/                 Domain-neutral kernel/runtime primitives
├── commerce/             Commerce domain + ACP adapter
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

AgentOS is in an architectural consolidation phase. The new domain-kernel and adapter boundary are present, but legacy domain/provider modules and the root dependency graph still contain concrete integrations. Therefore the repository should **not yet be advertised as fully removable-domain/domain-agnostic**.

The next architectural priorities are:

1. move concrete providers and domain implementations out of `src/core`;
2. establish explicit `src/core/ports` and adapter ownership;
3. separate core/runtime dependencies from optional integrations;
4. consolidate gateway/bootstrap entrypoints;
5. add a core-only install/test acceptance suite;
6. remove or quarantine legacy domain imports;
7. keep commerce, ACP, networking and channels behind their respective boundaries.

## License

Apache-2.0
