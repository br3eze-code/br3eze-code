# AgentOS Cross-Platform Agent Harness Interoperability

**Status:** architecture and integration plan. This document does not claim that every listed SDK is installed, production-wired, or tested.

## Objective

AgentOS should orchestrate agents, tools, and workflows across Linux, macOS, Windows, Android, browsers, containers, edge devices, and remote services without embedding every external SDK in its core or promising that every operation is available on every host.

The compatibility target is capability-based interoperability, not identical implementation or permissions everywhere.

## Non-negotiable architecture

1. **One execution owner:** AgentOS `AgentRuntime` / its canonical loop owns lifecycle, policy, execution records, approvals, cancellation, and audit. An imported harness must not silently create a second ungoverned execution path.
2. **Ports in core, SDKs in adapters:** no OpenAI, Google ADK, LangGraph, Anthropic, Android, OS-specific, or domain-specific SDK imports in core contracts.
3. **Explicit capabilities:** an adapter advertises only operations it implements and has passed its contract tests for. Missing capabilities return a stable `CAPABILITY_UNAVAILABLE` result; never fake success with a no-op.
4. **Local and remote are different deployment modes:** local adapters execute within the host's process and permissions; remote adapters call a configured service over an authenticated protocol. Both still pass through AgentOS authorization and audit policy.
5. **Host permissions are authoritative:** a model or agent cannot gain shell, filesystem, Android AppFunction, router, cloud, or admin privileges merely by asking for them.
6. **Compatibility before breadth:** each integration needs version bounds, licensing review, health checks, tests, cancellation/timeout behavior, secret handling, and a documented maintenance owner.

## Platform and execution profiles

| Profile | Intended environments | What AgentOS can promise | Important limit |
| --- | --- | --- | --- |
| Server runtime | Linux and macOS; Windows where Node/runtime dependencies support it | Orchestration, tools, workflows, APIs, persistence and process-level integrations configured by the operator | Host commands and filesystem access remain permissioned and deployment-specific |
| Android application | Android via Kotlin/Java or a Cordova/JS client calling a backend | UI, approved device APIs, local persistence, network-connected or supported on-device inference | No general server-shell access; Android permissions, SDK level, background-execution and OEM policies apply |
| Browser / PWA | Modern browsers and supported webviews | UI, browser APIs and authorized remote APIs | Browser sandbox restrictions; privileged work must be delegated to a trusted service |
| Edge / appliance | Small Linux computers, containers, single-board computers and network appliances | Only the tools exposed by the installed adapter and local policy | CPU, RAM, disk, architecture, connectivity and vendor API differences |
| Remote agent | An operator-configured agent service reachable through a supported protocol | Delegation, status, results and supported remote capabilities | Network, authentication, remote policy, protocol version and service availability apply |

Do not use OS-name checks as a substitute for capability checks. Runtime discovery should report host profile, adapter health, supported capability IDs, limitations and versions.

## Framework and SDK integration catalog

These are candidate integrations, not a claim of existing implementation or endorsement. Choose adapters based on real product requirements; do not install every SDK as a mandatory dependency.

| Framework / SDK | Best-fit role to evaluate | Integration direction |
| --- | --- | --- |
| Google Agent Development Kit (ADK) | Multi-agent orchestration; Python, TypeScript, Go, Java and Kotlin ecosystems | Language-specific adapters or a remote A2A/MCP boundary; evaluate Android Kotlin separately |
| OpenAI Agents SDK | Application-owned agent loop, tools, handoffs, guardrails and tracing in TypeScript/Python | Optional SDK adapter; keep provider credentials and SDK types outside core |
| LangGraph / LangChain | Stateful graph orchestration, checkpoints, resume and human review | Workflow adapter; map checkpoint durability and interrupts explicitly |
| Vercel AI SDK | TypeScript model/provider integration, streaming UI and tool calling | Model/streaming/UI adapter; not a substitute for AgentOS authorization |
| Mastra | TypeScript agent and workflow runtime | Optional framework adapter; test state, tools, tracing and streaming semantics |
| Pydantic AI | Typed Python agent and dependency/tool contracts | Python sidecar or remote adapter; do not force Python into the Node core |
| CrewAI / Microsoft Agent Framework / Strands Agents / Agno / smolagents | Alternative orchestration patterns and provider ecosystems | Evaluate individually against the same conformance suite before adoption |
| Claude Agent SDK and other vendor SDKs | Vendor-specific agent/runtime capabilities | Optional, versioned adapters with explicit vendor dependency and fallback policy |
| MCP | Tool discovery and invocation protocol | Tools only: namespaced, schema-validated, tenant-authorized and risk-gated |
| A2A | Agent-to-agent communication across processes and languages | Remote agent discovery/communication; authenticate and authorize every request |
| OpenAPI / JSON Schema / ordinary HTTP | Interoperability with existing services | Generate or register constrained tool adapters; validate input and output schemas |

### Avoid the “install everything” trap

- Core dependencies must remain small and platform-neutral.
- Each adapter declares optional peer/dependency requirements and supported versions.
- A framework's own runner may be used only behind an explicit adapter. AgentOS remains the policy and execution owner unless a deployment deliberately selects a documented external-runtime mode.
- Do not normalize away important differences: checkpoint semantics, streaming, tool schemas, cancellation, retries, context windows, traces, and billing must be represented as capabilities and documented constraints.
- A protocol integration is not proof of a framework integration. MCP support does not automatically make an ADK, LangGraph, or OpenAI Agents SDK project fully compatible.

## Canonical capability envelope

Every framework or remote-agent adapter should expose a descriptor equivalent to:

```json
{
  "id": "adapter-id",
  "version": "adapter-version",
  "runtime": "local | remote",
  "protocols": ["mcp", "a2a"],
  "capabilities": ["agent.run", "workflow.resume", "trace.read"],
  "limitations": ["streaming-unavailable"],
  "health": "healthy | degraded | unavailable"
}
```

This is an illustrative shape, not a live API contract. The implementation should validate descriptors at registration and reject unknown or duplicate capability IDs. Capabilities should be grouped where helpful:

- Agent lifecycle: create, get, list, run, status, pause, resume, remove.
- Execution: start, status, cancel, resume, verify, replay.
- Workflow: define, run, resume, cancel.
- State: session create/resume/close; checkpoint read/write; memory read/search/write.
- Tooling: discover, register, execute; schema validation; approval and policy checks.
- Observability: trace, audit, usage, evaluation and health.
- Host integration: filesystem, process, browser, Android, network, cloud or device operations, each independently permissioned.

Do not advertise a capability in a manifest until the handler is wired, authorization and tenant context are enforced, and positive/negative conformance tests exist.

## Security and reliability gates

- Derive tenant and user identity from authenticated server context, not model-generated arguments.
- Route all tools, including tools from external frameworks, through the canonical policy/capability boundary.
- Treat remote tool descriptions and schemas as untrusted data.
- Require approval for destructive, financial, privileged host, deployment, and other high-impact actions.
- Apply deadlines, cancellation, bounded output, rate limits, secret redaction and audit events.
- Make resumability durable only when the backing store actually persists checkpoints and supports the required consistency.
- Do not execute third-party skill code merely because its manifest parsed; use a real isolation boundary.
- Keep Android/device-specific actions behind explicit native capability adapters and platform permission checks.
- Test malicious descriptions, schema changes, tenant isolation, timeouts, disconnects, cancellation, approval replay, process restart and partial capability failure.

## Rollout order

1. Record the current `main` baseline and the PR branch baseline separately.
2. Fix existing CI and production regression failures before adding broad integration surface.
3. Strengthen the framework adapter contract to support declared, testable partial capabilities without fake methods.
4. Wire MCP and A2A through the canonical ToolRegistry / AgentRuntime composition root.
5. Add one reference local framework adapter and one remote-agent adapter; use them to validate the contract before adding more SDKs.
6. Add platform conformance jobs: Linux first, macOS/Windows where runners and dependencies are available, Android build/device tests, and browser tests.
7. Port additional frameworks only when a use case requires them; pin versions and test upgrade compatibility.
8. Remove duplicate runtime paths only after behavior, traceability and regression parity are demonstrated.

## Definition of done

- One authoritative execution/policy path or an explicitly documented external-runtime mode.
- Adapter capabilities are truthful, discoverable, versioned and health-checked.
- Unsupported host actions fail clearly and safely.
- Local and remote calls enforce identity, tenant scope, authorization, approval, timeouts and audit.
- Integration tests run in CI and failures are attributable to an adapter, runtime, or platform.
- No claim of “all platforms” or “all frameworks” without a published compatibility matrix and passing evidence.
