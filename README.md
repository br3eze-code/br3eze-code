# AgentOS

**Domain-agnostic agent harness for tools, skills, plugins, workflows, and model providers.**

AgentOS is a runtime-first agent platform. The core does not know whether a capability belongs to networking, coding, finance, commerce, documents, infrastructure, or something not yet invented. Domains are extensions.

> **Current architectural rule:** AgentRuntime is the canonical execution owner. Tools, skills, plugins, models, memory, policies, verification, and external adapters plug into that runtime; they do not create competing agent loops.

## What the harness provides

- **AgentRuntime** — one execution boundary and lifecycle owner.
- **Tools** — atomic executable capabilities with schemas, permissions, risk metadata, and audit hooks.
- **Skills** — reusable capability packages that group tools plus domain knowledge/instructions.
- **Plugins** — installable extensions with manifests, lifecycle hooks, permissions, and runtime access.
- **Model ports** — provider-neutral model interface; swap model vendors without changing orchestration.
- **Work graphs / WBS** — structured decomposition and dependency-aware execution.
- **Sessions and memory ports** — state can be local, database-backed, or remote.
- **Guardrails and permissions** — authorization belongs at the execution boundary, not in prompts.
- **Verification** — work is not complete merely because a model stopped generating.
- **Observability** — runtime events, tool metrics, transcripts, and execution records.
- **Interoperability** — external capability protocols such as MCP can be adapters rather than core dependencies.

## Architecture

~~~text
                         +------------------------------+
                         |          AgentRuntime        |
                         |  understand -> plan ->       |
                         |  execute -> observe ->        |
                         |  evaluate -> verify -> done   |
                         +--------------+---------------+
                                        |
                +-----------------------+------------------------+
                |                       |                        |
          Capability Registry      Model Port              State Ports
                |                       |                        |
        +-------+--------+        +-----+-----+          +---------+----+
        |       |        |        | providers |          | session      |
      Tools   Skills  Plugins     | local/LLM |          | memory       |
        +-------+--------+        +-----------+          | checkpoint   |
                |                                      +--------------+
                v
       +---------------------+
       | Domain extensions   |
       | network / code /    |
       | docs / commerce /   |
       | anything else       |
       +---------------------+
~~~

### One owner, many capabilities

The runtime owns **orchestration**, not domain behavior.

~~~text
Plugin / Skill / Tool / Protocol adapter
                 |
                 v
          AgentRuntime
                 |
        permission + policy
                 |
                 v
             execute
                 |
        observe + record
                 |
                 v
             verify
~~~

There should not be a second hidden AgentEngine, AgentKernel, ReAct loop, or domain-specific orchestrator competing with this path.

## Tool contract

Tools are the smallest executable unit.

~~~js
{
  name: "example.lookup",
  description: "Look up an entity",
  parameters: {
    type: "object",
    properties: { id: { type: "string" } },
    required: ["id"]
  },
  permissions: ["example:read"],
  risk: "low",
  execute: async (args, context) => ({ /* result */ })
}
~~~

The model may request a tool, but the model never gets to execute it directly. AgentRuntime sends the call through the registered execution and authorization boundary.

## Skill contract

A skill is a reusable capability package. It may contain:

- instructions and knowledge for the agent;
- one or more tools;
- examples and routing metadata;
- validation;
- lifecycle hooks;
- domain-specific implementation.

A skill is **not another agent runtime**. Its tools execute through the runtime's canonical boundary.

~~~text
skills/
└── example/
    ├── manifest.yaml
    ├── SKILL.md
    ├── index.js
    └── tools/
        ├── lookup.js
        └── update.js
~~~

## Plugin contract

Plugins are installable extensions with an explicit manifest:

~~~js
{
  id: "example.plugin",
  version: "1.0.0",
  apiVersion: "1",
  capabilities: ["example.lookup"],
  permissions: ["capability:register"],
  isolation: "in-process"
}
~~~

Lifecycle:

~~~text
load -> register -> initialize -> start
                         |
                       run
                         |
                    stop -> unload
~~~

The plugin SDK lives under src/sdk/plugin/. A plugin receives a controlled PluginContext; it does not receive unrestricted access to process internals.

## Model independence

Models are behind a port. The runtime should operate with hosted frontier models, self-hosted/open models, local models, and test doubles.

The orchestration contract should not contain provider-specific branching such as "if Gemini" or "if Anthropic". Provider differences belong in adapters.

## Execution loop

~~~text
Receive
  |
Understand
  |
Plan / WBS
  |
Select capabilities
  |
Authorize
  |
Execute tool(s)
  |
Observe result
  |
Evaluate
  |
Retry / handoff / escalate when required
  |
Verify against acceptance criteria
  |
Complete
~~~

For parallel work, the runtime can execute independent work-graph nodes concurrently while preserving dependency and verification semantics.

## Security model

Security is enforced at execution time.

1. Model proposes an action.
2. Runtime resolves the capability.
3. Policy checks identity, permissions, scope, risk, and context.
4. Guardrails validate inputs.
5. Human approval can be required for configured operations.
6. The capability executes.
7. Output guardrails/redaction run.
8. The result is recorded for audit and verification.

Never rely on a system prompt as the authorization boundary.

## Interoperability

AgentOS can consume external capabilities through adapters. MCP is a good example: an MCP server can provide tools to the runtime without forcing MCP into the core execution model.

~~~text
external protocol
      |
   adapter
      |
canonical Tool/Skill contract
      |
AgentRuntime
~~~

## Repository map

~~~text
src/
├── core/
│   ├── agentRuntime.js       <- canonical runtime owner
│   ├── ToolRegistry.js       <- capability storage/dispatch
│   ├── permissions.js        <- execution policy boundary
│   ├── agent-loop.js         <- turn state machine
│   ├── action-wbs.js         <- work decomposition
│   └── ports/                <- provider-neutral contracts
├── sdk/plugin/               <- plugin SDK + manifest + lifecycle
├── adapters/                 <- external/domain integrations
├── skills/                   <- domain capability packages
├── workgraph/                <- dependency-aware execution
├── verification/             <- completion verification
├── channels/                 <- user-facing transports
└── host/                     <- composition/bootstrap

tests/
├── unit/
└── integration/
~~~

Legacy implementations may still exist while migration is in progress. They are not architectural owners merely because they remain in the tree. New orchestration code belongs in AgentRuntime.

## Minimal embedding

~~~js
import { AgentRuntime } from './src/core/agentRuntime.js';

const runtime = new AgentRuntime({
  model: myModelPort,
  permissionMode: 'prompt'
});

runtime.registerTool({
  name: 'example.lookup',
  description: 'Look up an entity',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id']
  },
  execute: async ({ id }) => ({ id, found: true })
});

const result = await runtime.execute({
  content: 'Look up entity 42',
  context: { permissions: ['example:read'] }
});

console.log(result.response);
~~~

## Domain example: networking

Networking is an extension, not the definition of the harness.

A networking deployment can install skills/tools such as:

~~~text
network.ping
network.interfaces
network.firewall
network.devices
~~~

Another deployment can install:

~~~text
code.search
code.test
docs.query
finance.invoice
commerce.order
~~~

The runtime remains the same.

## Development

Requirements:

- Node.js 22.x
- npm

~~~bash
npm install
npm test
npm run lint
npm run build
~~~

Useful checks:

~~~bash
npm run test:production
npm run check:ci-quality
npm run build:types
~~~

## Deployment

The repository is connected to Vercel for deployment. Vercel is a host/deployment concern; it is not part of the AgentRuntime contract.

Production deployments should prove:

1. source builds successfully;
2. tests pass;
3. runtime imports cleanly;
4. capability discovery is deterministic;
5. permissions are enforced;
6. tool execution is observable;
7. verification can distinguish completion from failure.

## Design principles

### Core owns semantics, adapters own integrations

Core defines contracts and lifecycle. Adapters translate external systems into those contracts.

### Capabilities are data before they are code paths

A manifest should make a capability discoverable, inspectable, versionable, and permission-aware before execution.

### One execution boundary

Human calls, model calls, workflows, scheduled work, and plugin actions must converge on the same runtime authorization and execution boundary.

### Bounded autonomy

Every run needs limits: turns, budget, concurrency, permissions, retries, timeouts, and scope.

### Evidence beats confidence

The runtime should complete work because acceptance criteria are verified, not because the model says it is done.

### Simplicity beats framework accumulation

The execution path should remain followable from request to capability to verification without traversing several competing orchestration systems.

## Status

AgentOS is actively consolidating a historically evolved codebase toward this architecture. The goal is not to add more agent abstractions. The goal is to **make one runtime authoritative, migrate useful behavior into it, remove duplicate execution paths, and keep domain integrations at the edges.**
