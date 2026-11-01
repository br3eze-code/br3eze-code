# Runtime-Agnostic AgentOS Platform

Status: target architecture and migration contract  
Scope: domain-neutral AgentOS core with replaceable host, provider, and client adapters.

## Architectural invariant

AgentRuntime remains the single owner of agent orchestration and tool execution. No client, plugin, skill, domain, model provider, or protocol adapter may create a competing orchestration loop.

The harness must not require Cordova, Expo, React Native, a particular model vendor, database, cloud, network vendor, payment processor, or business domain to exist.

## Layers

1. **Host OS and hardware** — Linux, Windows, macOS, Android, iOS, CPU, memory, filesystem, process and network primitives. The host OS owns hardware access and process isolation.
2. **Managed execution runtime** — Node.js initially; configuration, module loading, lifecycle, shutdown, resource budgets, health checks, and supervised workload processes. Keep OS-specific behavior behind host adapters.
3. **Infrastructure ports** — filesystem, secret store, clock, random IDs, event transport, database, blob storage, queues, telemetry, and network access. Provide in-memory/local defaults where safe and practical.
4. **Capability and policy boundary** — identity/principal, permissions, policy decisions, approvals, quotas, tenant scope, audit records, and capability grants. Deny by default for privileged operations.
5. **Agent harness** — the canonical AgentRuntime, planning/work graph, tool registry, skill and plugin loading, session/memory ports, model port, observe/evaluate/verify loop, and human-in-the-loop approval.
6. **Transport/API boundary** — HTTP, WebSocket, CLI, MCP, A2A and other protocols implemented as adapters. Protocol handlers call the same runtime services and do not own execution loops.
7. **Client runtimes** — web/PWA, Cordova, Expo/React Native, desktop and future clients. These are presentation and device-capability adapters, not sources of business truth.
8. **Domain workloads** — Wi-Fi billing, network operations, coding, documents, commerce, support, or future domains. Domains register capabilities and policies; they do not change the core runtime.

## Dependency direction

Dependencies point inward toward stable contracts. Core code must not import UI frameworks, Cordova/Expo APIs, provider SDKs, business-domain modules, or deployment-specific configuration.

Domain workload -> capability contracts -> AgentRuntime -> ports -> infrastructure adapters -> host OS

Adapters implement contracts; core services consume contracts. Do not create a dependency from core back into a concrete adapter.

## Shared mobile architecture

Cordova and Expo should implement the same product-level contracts where they expose the same capability. They do not need identical device code.

- Share domain rules, request/response schemas, validation, error types, API contracts, and compatible pure JavaScript/TypeScript utilities.
- Keep Cordova plugins behind a Cordova adapter.
- Keep Expo modules and React Native native modules behind an Expo adapter.
- Put privileged network, payment, and tenant authorization decisions on the server whenever possible.
- Do not assume a Cordova plugin can run in Expo, or that a WebView wrapper supplies native feature parity.
- Treat the current Expo WebView app as a migration bridge until each required workflow is implemented and tested.

## Contract examples

Prefer interfaces such as:

- ModelPort: generate/stream structured model responses; provider selection stays outside orchestration.
- ToolExecutor: validate, authorize, execute, audit and normalize results.
- SessionStore / MemoryStore: persist state without coupling to a specific database.
- StoragePort: local and remote storage implementations with explicit consistency behavior.
- NetworkManagementPort: authenticated operations against network infrastructure; no router credentials in mobile clients.
- PaymentPort: provider-neutral payment intents, status and reconciliation.
- DeviceCapabilities: optional capabilities such as camera, local notifications, Bluetooth or printing. A client reports support; unsupported capabilities return a typed error instead of silently pretending success.
- ApprovalPort: suspend risky work until an authorized human decision is received.
- EventPort / TelemetryPort: structured events without requiring a particular vendor.

Use versioned schemas at process and network boundaries. Validate untrusted inputs and outputs. Define timeouts, cancellation, retries, idempotency, and error semantics for every remote port.

## Domain isolation

Domain selection should determine which domain packages and adapters are registered. Core packages must not import domain code. Domain-specific defaults may exist in a deployment composition root, but must not leak into core policy or orchestration.

A domain package may register tools, skills, schemas, UI routes, and adapter bindings. It may not bypass authorization, directly invoke a model to create a parallel tool loop, or access infrastructure outside its granted ports.

## Security boundaries

- Treat model output, tool arguments, plugin code, skills, inbound events, and remote provider responses as untrusted.
- Authorize every privileged tool invocation at the execution boundary, not only in prompts or UI.
- Scope sessions and storage to principal/tenant/workspace.
- Keep secrets server-side or in an OS-backed secure store; never ship server credentials in a mobile bundle.
- Apply explicit allowlists for outbound network access where appropriate, payload limits, timeouts, cancellation, rate limits, and audit trails.
- Do not describe a plugin as sandboxed unless the implementation actually enforces process/permission isolation.

## Migration sequence

1. Inventory existing core modules, adapters, domain imports, mobile plugins, and public contracts before moving code.
2. Define contracts around existing working behavior; avoid a wholesale rewrite.
3. Introduce adapter bindings through one composition root. Keep compatibility shims temporarily and deprecate them with tests.
4. Add architecture gates that reject core imports from Cordova, Expo, UI frameworks, provider SDKs, and domain directories.
5. Add contract tests once, then run the same tests against every adapter implementation.
6. Implement the shared API contracts in Cordova first where functionality already exists; add Expo implementations incrementally.
7. Test offline recovery, authorization denials, sync conflicts, cancellation, retries and unsupported device capabilities on each target platform.
8. Remove duplicate implementations only after call sites are migrated and tests demonstrate equivalent behavior.

## Definition of done

- Exactly one canonical AgentRuntime owns orchestration.
- Core can be imported and tested without loading a domain or vendor SDK.
- A new model, database, transport, client runtime or domain can be added through contracts without editing core orchestration.
- Cordova and Expo pass the same applicable contract tests.
- Unsupported features fail explicitly and safely.
- CI checks dependency direction, contract compatibility, tests, security checks, and build outputs.
- Documentation distinguishes implemented, tested, and planned capabilities.

## Important non-goal

This architecture is not itself a standalone operating-system kernel. A Node.js managed runtime runs on a host OS. A future bootable distribution or kernel project would be a separate layer with separate hardware, memory, scheduling, driver, boot and recovery requirements.
