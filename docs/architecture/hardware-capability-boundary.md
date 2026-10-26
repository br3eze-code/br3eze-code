# Level 1 — Hardware capability boundary

Status: Level 1 includes a read-only RouterOS adapter and focused unit tests. It has not been verified against a live router in this workflow, and the full test suite has not yet been confirmed green.

## Ownership

- `AgentRuntime` remains the single execution owner.
- The canonical `ToolRegistry` remains the single tool registration/execution boundary.
- `HardwareCapabilityRegistry` is a domain-neutral inventory/adapter boundary; it does not create a second agent loop.
- Device adapters own the actual transport (USB/HID, serial, Bluetooth, local network, RouterOS, GPIO, robotics SDK, etc.). They must expose only named capabilities.

## Adapter contract

Each adapter supplies a simple `id` and a non-empty `capabilities` array. Every capability declares a unique `name`, `access: 'read' | 'write'`, JSON-schema-like `schema`, and an `execute(args, context)` function. Register an adapter through `runtime.registerHardwareAdapter(adapter)` at the composition root. The first concrete adapter is `src/adapters/hardware/mikrotik-hardware-adapter.js`; it reuses the existing network adapter and exposes only read-only system statistics, interface listing and active hotspot-user listing.

Mounted tools are namespaced as `hardware.<adapter-id>.<capability-name>`. Arbitrary shell strings and undeclared device operations are not part of the contract.

## Safety and reliability defaults

- Authenticated tenant and user context is mandatory; a device operation must carry trusted host identity, not identity inferred from model-supplied arguments.
- The canonical ToolRegistry capability gate also requires a live execution task and an explicit `authorizedCapabilities`/ `capabilities` grant for the namespaced permission. Merely mounting an adapter does not grant the model or user access.
- Every write capability requires explicit approval, regardless of agent permission mode.
- The adapter receives a cancellation signal, operation ID, scoped tenant/user identity and approval metadata. The registry races the operation against timeout/cancellation and cleans up listeners; adapters must still honor the signal to stop underlying I/O.
- Operations have a bounded deadline; adapters should honor the cancellation signal and make writes idempotent where possible.
- The adapter itself must validate arguments and device state. This boundary is not a substitute for OS permissions, device ACLs, physical interlocks, or vendor safety controls.
- Do not expose a generic `shell.exec`, unrestricted serial command, or raw device path as a model-callable capability.

## Level 1 acceptance

1. Registry is independently testable.
2. Read operations require identity; write operations fail closed without approval.
3. Tool registration flows through the canonical registry.
4. Timeouts and cancellation are visible to adapters.
5. RouterOS read-only integration is implemented and covered with a fake manager; live-router validation is still outstanding. No write-capable device operation is currently exposed by the RouterOS adapter.

## Next slice

Validate the RouterOS adapter against a simulator or lab router with read-only credentials, then add approved, narrowly scoped write operations only after idempotency and rollback behavior are tested.
