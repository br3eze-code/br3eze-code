# Level 1 — Hardware capability boundary

Status: first implementation slice; adapter contract and guarded registration exist, but no physical-device adapter is enabled by this change.

## Ownership

- `AgentRuntime` remains the single execution owner.
- The canonical `ToolRegistry` remains the single tool registration/execution boundary.
- `HardwareCapabilityRegistry` is a domain-neutral inventory/adapter boundary; it does not create a second agent loop.
- Device adapters own the actual transport (USB/HID, serial, Bluetooth, local network, RouterOS, GPIO, robotics SDK, etc.). They must expose only named capabilities.

## Adapter contract

Each adapter supplies a simple `id` and a non-empty `capabilities` array. Every capability declares a unique `name`, `access: 'read' | 'write'`, JSON-schema-like `schema`, and an `execute(args, context)` function. Register adapters, then call `registry.mount(runtime.toolRegistry)` at the composition root.

Mounted tools are namespaced as `hardware.<adapter-id>.<capability-name>`. Arbitrary shell strings and undeclared device operations are not part of the contract.

## Safety and reliability defaults

- Authenticated tenant and user context is mandatory.
- Every write capability requires explicit approval, regardless of agent permission mode.
- The adapter receives a cancellation signal, operation ID, scoped tenant/user identity and approval metadata.
- Operations have a bounded deadline; adapters should honor the cancellation signal and make writes idempotent where possible.
- The adapter itself must validate arguments and device state. This boundary is not a substitute for OS permissions, device ACLs, physical interlocks, or vendor safety controls.
- Do not expose a generic `shell.exec`, unrestricted serial command, or raw device path as a model-callable capability.

## Level 1 acceptance

1. Registry is independently testable.
2. Read operations require identity; write operations fail closed without approval.
3. Tool registration flows through the canonical registry.
4. Timeouts and cancellation are visible to adapters.
5. Physical control is not claimed until a concrete adapter is installed and tested against target hardware.

## Next slice

Implement one real, narrowly scoped adapter against hardware the deployment actually has (for example, MikroTik RouterOS read-only inventory first), then add integration tests using a simulator or lab device before enabling write operations.
