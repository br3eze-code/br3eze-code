# AgentOS Level 2: application platform foundation

## Purpose

This slice begins an OS-like application platform inside the existing Node.js AgentOS. It is not a bootable kernel or a security sandbox. The canonical `AgentRuntime` remains the owner of agent execution; platform services are lifecycle and capability infrastructure around it.

## First foundation modules

- `src/platform/application-manifest.js`: validates a small declarative application manifest (identifier, semantic version, relative entrypoint, requested capabilities, and service IDs).
- `src/platform/permission-policy.js`: default-deny capability decisions, explicit grants/revocation, and a typed denial error.
- `src/platform/ipc-bus.js`: in-process, allowlisted topic messaging with JSON-safe envelopes and payload size limits. Optional policy checks gate publishing.
- `src/platform/service-supervisor.js`: register/start/stop service lifecycle, dependency checks, observable state, and reverse-order shutdown.

## Security boundary

The permission policy is not a substitute for process isolation. Each privileged host adapter must check the policy at the moment it performs an operation. Do not pass credentials or unrestricted host objects to application code. Untrusted workloads require a real OS/container/VM sandbox and resource controls before execution.

IPC is currently in-process and synchronous event delivery; it is not yet cross-process IPC, durable messaging, or a distributed event bus. The supervisor does not automatically restart crashed processes and does not execute arbitrary manifest entrypoints.

## Acceptance checks

Run `node --test tests/platform/platform-foundation.test.js` to exercise manifest validation, default-deny permission checks, IPC allowlisting/limits, dependency ordering, and lifecycle failure handling.

## Next slices

1. Connect supervisor status to the runtime's health/readiness model without creating a second executor.
2. Add persistent service state and idempotent recovery.
3. Add a package install/verify/rollback workflow using content hashes and signed manifests.
4. Introduce process-isolated workloads with resource limits and policy-enforced host bridges.
5. Add local-first storage contracts and opt-in cloud synchronization.
