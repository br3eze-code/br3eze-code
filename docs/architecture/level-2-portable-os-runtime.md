# Br3eze OS Level 2 — Portable Runtime and Hardware Abstraction

## Goal

Make applications and agents portable across hosts by defining stable OS-facing contracts. The runtime is not a replacement kernel and does not claim direct control of every machine. It runs as a host process today; platform-specific host adapters bridge permitted OS and device APIs.

## Architecture

1. Applications and agents call stable runtime services, not OS-specific APIs.
2. The canonical AgentRuntime owns task execution and tool dispatch; Level 2 must not create a second agent loop.
3. Platform adapter registry advertises host capabilities, tracks lifecycle, and routes calls.
4. Level 1 hardware capability registry gates device operations and write approvals.
5. Host adapters isolate Node.js, Cordova, desktop, embedded Linux, and network equipment specifics.
6. Native OS/device drivers remain owned by Windows, Linux, macOS, Android, iOS, HarmonyOS, firmware, and vendors.

## Contract rules

- Platform IDs use `platform.<adapter>.<capability>`; Level 1 hardware IDs remain `hardware.<adapter>.<capability>`.
- Discovery reports actual declared availability; callers must not assume every capability exists on every host.
- Adapter lifecycle is explicit: created → starting → ready/failed → stopping → stopped.
- Calls are rejected unless the adapter is ready. Write capabilities require explicit approval.
- Adapter code owns OS-specific imports and I/O. Core contracts must not import Cordova, Android, iOS, Windows, Linux, RouterOS, or vendor SDKs.
- Authentication, tenant isolation, capability grants, and audit policy must also be enforced by the canonical runtime/security boundary. This registry alone is not a sandbox.
- Cancellation is passed to adapters; host APIs may not support interrupting in-flight native calls.
- Do not expose arbitrary shell execution, raw device paths, unrestricted memory access, or implicit privilege escalation as portable capabilities.

## Compatibility strategy

- Node.js server/desktop is the first host target because the current project runs on Node.js 22.
- Cordova mobile support should be implemented as a bridge adapter over explicit native plugin APIs.
- Linux/ARM edge support requires explicit service/device adapters; GPIO, USB, Bluetooth, and network access are not assumed.
- Windows/macOS adapters must use supported host APIs and least privilege.
- Android/iOS/HarmonyOS support depends on platform policies, app entitlements, plugin availability, and vendor restrictions.
- A genuinely bootable OS needs a separate kernel/boot chain, drivers, memory/process isolation, filesystem, and hardware bring-up. This patch does not provide those.

## Level 2 exit criteria

- [x] Domain-neutral adapter registration and capability discovery.
- [x] Explicit lifecycle and fail-closed invocation before ready.
- [x] Explicit approval for writes.
- [x] Host-platform capability filtering.
- [x] Unit tests for registration, lifecycle, approval, cancellation, and discovery.
- [ ] Connect registry to the canonical runtime without creating a second executor.
- [ ] Run focused tests and repository CI successfully.
- [ ] Implement a real Node.js host diagnostics adapter without shell execution.
- [ ] Validate one Cordova bridge before claiming mobile portability.
- [ ] Threat-model native bridge permissions and lifecycle races.
