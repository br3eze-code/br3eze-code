# Custom Plugin WBS Safety Agents

This is the governance layer for every custom Cordova plugin. It applies the WBS-to-WBS pattern: each work breakdown item is owned by a small, auditable specialist and cannot silently cross its boundary.

## WBS-00 — IntakeAgent
- Normalize the requested operation.
- Reject malformed or ambiguous native calls.
- Never infer credentials, network targets, or authorization.

## WBS-10 — CapabilityAgent
- Report what the current platform/API actually supports.
- Never advertise a capability merely because an API exists on another version.
- Unsupported operations return structured `UNSUPPORTED` results.

## WBS-20 — CompatibilityAgent
- Gate Android API/OEM-specific APIs before loading or calling them.
- Keep legacy WiFiWizard2 compatibility isolated from the canonical network contract.
- Treat ColorOS, MagicOS, HarmonyOS/EMUI, One UI, MIUI/HyperOS and other OEMs as adapters, not separate business domains.

## WBS-30 — PermissionAgent
- Request only permissions required for the requested operation.
- Never request background/location/notification permissions as a blanket startup requirement.
- Respect denial and return actionable structured errors.

## WBS-40 — SecurityAgent
- No router credentials, tokens, or secrets in native source.
- No arbitrary remote execution from local Cordova bridges.
- No privilege escalation or bypass of platform security controls.
- Validate all JSON input and bound resource sizes.

## WBS-50 — LifecycleAgent
- Every worker, receiver, listener, service, detector, and executor must have an explicit shutdown path.
- Avoid starting background services automatically merely because a plugin is loaded.
- Prevent duplicate initialization and callback leaks.

## WBS-60 — DomainBoundaryAgent
- AgentOS core stays domain agnostic.
- Wi-Fi/network primitives belong in adapters.
- Billing, vouchers, mesh, commerce and Power Connect policy belong above the network contract.

## WBS-70 — TestAgent
Required gates:
1. JavaScript syntax/unit tests.
2. Android compile checks.
3. API 21, 28, 29, 33, 35, 36 and 37 smoke tests where the platform supports them.
4. OEM smoke tests for Samsung, Xiaomi/HyperOS, OPPO/ColorOS, Huawei/HarmonyOS, HONOR/MagicOS and stock Android.
5. iOS compile/device tests for supported deployment targets.
6. Negative tests for denied permissions, unsupported APIs, malformed input and duplicate lifecycle calls.

## WBS-80 — EvidenceAgent
A release is not marked compatible until the result is backed by a build/test artifact. Static source inspection may mark a risk as fixed, but cannot claim a physical-device pass.

## WBS-90 — ReleaseAgent
A plugin may be released only when all applicable WBS gates pass. Failed optional capabilities must degrade to `UNSUPPORTED` rather than crash or fabricate success.
