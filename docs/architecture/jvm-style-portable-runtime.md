# JVM-inspired portable runtime architecture

## Intent

Borrow the useful architectural ideas of the JVM without claiming to implement Java bytecode, garbage collection, or a JVM-compatible ABI:

- a stable host-neutral runtime contract;
- explicit service-provider interfaces (SPIs);
- adapters for operating systems, hardware, model inference, storage, networking and identity;
- normalized capability and hardware profiles;
- controlled lifecycle and application permissions;
- provider selection by kind, capability and explicit preference.

## Modules

- `ProviderRegistry` is the SPI catalog. Providers declare an ID, kind, semantic version, capabilities and optional priority. Registration is explicit; importing a module never silently grants permissions.
- `HardwarePort` exposes a normalized best-effort profile. Unknown hardware facts remain unknown instead of being guessed. Platform-specific probes belong in adapters.
- `nodeHardwareProvider` is one optional Node.js host adapter. Browser, embedded, remote and other operating-system adapters can implement the same probe contract.
- `RuntimeEnvironment` composes provider registry, IPC, permissions and the service supervisor. It does not own agent execution; the existing canonical `AgentRuntime` remains the sole agent executor.

## Provider contract

A provider declares `id`, `kind`, `version`, and `capabilities`. The registry treats implementation methods as adapter-owned and does not call them automatically. Callers should validate the relevant method contract at the boundary where the provider is consumed. Prefer an explicit provider ID when reproducibility matters; priority-based selection is a fallback, not a security decision.

Kinds currently include model, storage, network, hardware, messaging, identity and custom. New kinds can be introduced deliberately as the platform evolves.

## Security and portability limits

This registry is not a sandbox. Provider code executes with the host process's privileges. A permission declaration is not sufficient to isolate a provider. Untrusted provider code requires process/VM isolation and policy-enforced host bridges. Hardware profiles are best effort and may expose less information on browsers, mobile systems, containers or restricted environments.

The IPC bus is currently in-process. Package verification, signatures, cross-process IPC, durable service recovery, CPU/memory quotas and secure plugin loading remain later stages.

## Test

Run `node --test tests/platform/platform-foundation.test.js tests/platform/portable-runtime.test.js`.
