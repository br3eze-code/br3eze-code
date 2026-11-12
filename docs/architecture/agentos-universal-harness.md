# AgentOS universal harness: app, operating system, and device capability architecture

**Status:** architecture and maintenance plan based on the repository's current code and declared ownership. This document is not proof that AgentOS is a bootable OS, has privileged access to every device API, or has passed a full integration/security audit.

## Executive decision

AgentOS should be a **universal capability harness** with one execution owner and multiple host adapters. It should run as:
1. a web/PWA client,
2. a Cordova mobile app,
3. a Node.js CLI/gateway/service,
4. a desktop host,
5. eventually, a system-integrated application on an independently maintained AOSP-based AgentOS OS.

“Universal” means a shared task/tool/skill/approval/verification contract with different adapters—not one binary, one permission set, or identical hardware capabilities on every platform.

**Non-negotiable:** `src/core/agentRuntime.js` owns model/tool turns. `src/core/tool-registry.js` is the canonical tool execution boundary. `HardwareCapabilityRegistry` advertises explicitly declared device capabilities; it does not grant authority. Android's OS remains the enforcement authority for app permissions, Binder services, SELinux and hardware access.

## 1. What the app is today

### Web application / PWA

The web interface is served from `www/index.html` with CSS and JavaScript under `www/`. The page contains the Power Connect / Wi-Fi billing experience and shares the repository with the broader AgentOS harness. The visible app identity, package identity, and product positioning need a product decision: `config.xml` names the Cordova app “AgentOS” and uses app ID `africa.br3eze`, while the current page title says “Power Connect”. Do not silently rename identifiers because that can break upgrades, storage or store listings.

The PWA uses web platform features where supported. A browser/PWA cannot invoke arbitrary native Android APIs; it can only use web APIs and installed, permissioned integration points. Service-worker/offline behavior must be tested separately from Cordova behavior.

### Cordova application

The current Cordova wrapper uses `config.xml`, a single Android Activity containing a WebView, and plugins that bridge JavaScript to native code. Cordova's lifecycle events such as `deviceready`, `pause` and `resume` are useful lifecycle signals, but do not exactly mirror every native lifecycle callback.

Relevant current paths:
- `config.xml`: app identity, SDK levels, permissions, navigation intents and Cordova hooks.
- `www/index.html`: web UI entry point.
- `custom-plugins/cordova-plugin-wifi-billing-agent/plugin.xml`: plugin registration and JavaScript modules.
- `custom-plugins/cordova-plugin-wifi-billing-agent/www/WifiBillingAgent.js`, `DomainConnectivity.js`, and `WiFiWizard2Compat.js`: JavaScript-facing plugin contracts.
- `custom-plugins/cordova-plugin-wifi-billing-agent/src/android/`: native Android implementation, including Wi-Fi APIs.
- `scripts/cordova-hooks/`: build-time mutation/signing hooks; these must be deterministic, tested and auditable.

The custom Wi-Fi plugin contains compatibility APIs and Android-specific network logic. That is a host adapter—not the AgentRuntime and not an OS-wide privilege mechanism. Android version, OEM policy, target SDK, permission state, foreground/background restrictions, and the particular Wi-Fi API determine what actually works. A JavaScript success callback is not sufficient proof that a device connected; verify state through independent platform observations.

### Immediate Cordova review items

1. `config.xml` currently declares `<access origin="*" />` and broad HTTP/HTTPS intents. Review whether these are actually required; replace broad allowances with least-privilege policy where compatible. This is a review item, not an automatic edit.
2. Audit declared permissions against the methods that use them. Remove permissions with no justified feature; request runtime permissions only when needed, explain why, and handle denial gracefully.
3. Check remote font/icon CDN dependencies against offline requirements, CSP and supply-chain risk. Prefer bundled, version-pinned assets for core screens.
4. Test `after_prepare` minification/obfuscation and `before_compile` signing hooks in clean builds; never let a hook silently change untracked source or leak signing secrets.
5. Confirm `config.xml`, `package.json`, plugin.xml, AndroidManifest, generated platform files and release metadata agree on app ID, version and SDK constraints.
6. Keep the WebView-to-native bridge narrow. Validate every action and argument natively; JavaScript checks are not authorization.

## 2. How the operating system works

AgentOS mobile OS is intended to be an independently maintained AOSP-derived product with selectively evaluated GrapheneOS-inspired hardening. It is not currently equivalent to a completed OS.

Conceptual stack:

```text
Device hardware + secure boot chain
  └─ Bootloader / Verified Boot / rollback protection (device-dependent)
      └─ Linux kernel + drivers + device/vendor components
          └─ HALs and native system services
              └─ Android framework + Binder IPC + ART
                  ├─ App sandbox, SELinux, permissions, profiles
                  ├─ System UI, Settings, update/recovery components
                  └─ AgentOS platform service (future, narrow Binder API)
                      └─ Authenticated AgentOS host adapter
                          └─ AgentRuntime (single execution owner)
                              └─ ToolRegistry → declared capability adapters
```

The Linux kernel is the base layer, but it is not the whole operating system. Hardware access is mediated through device drivers, HALs, Android framework APIs and system services. Most ordinary apps run in per-app security sandboxes. A regular Cordova app cannot independently implement kernel hardening, Verified Boot, global clipboard rules, system-wide sensor/network restrictions or hardware-backed attestation.

The future AgentOS platform service must expose a small, versioned Binder contract, not unrestricted shell/root access. It should authenticate the caller, check Android user/profile and capability grants, validate inputs, apply risk/approval policy, invoke the canonical runtime through a host adapter, and return structured results. OS policy and AgentRuntime policy are complementary; neither should assume the other makes all checks.

### OS workspaces and provenance

- Keep AOSP source and build output outside this Node.js repository.
- Keep a pinned AOSP manifest lock and build evidence.
- Keep a separate GrapheneOS reference checkout.
- Port individual changes only after identifying exact upstream commits, license, AOSP base, device dependencies and tests.
- Track each patch in `mobile-os/security-patch-ledger.csv`.
- Do not call an emulator build bit-reproducible until independent clean builds and artifact comparisons establish that result.
- Do not claim support for physical devices until vendor firmware, boot chain, drivers, radio, camera, power management, updates and recovery are qualified.

## 3. The harness as it exists in code

### Canonical execution path

- `src/core/agentRuntime.js`: canonical owner of agent model/tool turns, task/session coordination and the runtime-facing lifecycle.
- `src/core/tool-registry.js`: canonical tool registration and execution boundary; `src/core/ToolRegistry.js` is a compatibility facade.
- `src/core/capability-boundary.js`: capability descriptors, phase/risk/permission checks and execution intents.
- `src/core/agent-authorization.js`: fail-closed persistent agent identity, membership, policy and resource-scope checks.
- `src/core/permissions.js`: legacy permission modes and tool tiers; review its behavior against the canonical registry rather than treating it as the only security boundary.
- `src/core/PluginManager.js`: plugin loading and capability metadata.
- `src/core/hardware/HardwareCapabilityRegistry.js`: namespaced, schema-checked hardware capabilities with timeouts/cancellation.
- `src/adapters/hardware/`: host/device-specific implementation; the adapter owns actual transport.
- `src/core/os/ServiceSupervisor.js`, `IPCMessageBus.js`, `ApplicationManager.js`: service lifecycle, tenant-scoped IPC and application-to-service metadata. These are lifecycle/IPC abstractions, not OS-level sandboxes.
- `src/core/ports/`: provider-neutral model and state contracts.
- `src/core/verification/` and observability/session modules: verification, event and audit evidence.

The architecture already has useful primitives, but the presence of a class or an architecture note does not prove every entry point uses it. CLI, HTTP, WebSocket, schedule, plugin, Cordova and future Binder paths need a route-by-route audit. Every route should call the same trusted runtime composition and canonical registry; none should directly invoke a provider or hardware adapter around policy.

### Execution lifecycle

```text
Request from UI / CLI / API / device event
  → authenticate caller and derive trusted identity
  → resolve requested skill and declared tool capability
  → validate schema, tenant/profile/resource scope and policy
  → plan work and request human approval when required
  → AgentRuntime invokes ToolRegistry
  → adapter performs bounded operation with timeout/cancellation
  → observe actual device/system result
  → verify postcondition independently
  → append redacted audit/evidence record
  → return result to the calling UI
```

The model proposes actions; it is not an authority source. A model-generated role, tenant ID, approval, or permission must never be trusted without host-side validation. Hardware writes should fail closed without explicit authorization and approval. Do not expose generic shell execution or arbitrary device paths as model-callable tools.

## 4. Universal capability contract

Every platform should expose the same *shape* of capability metadata, while platform adapters report whether each capability is available.

Required metadata:
- stable capability ID and version;
- host/platform and minimum supported version;
- access class: read or write;
- risk and approval requirement;
- required permissions and user consent;
- input/output schema;
- timeout, cancellation and idempotency behavior;
- data classification and redaction policy;
- offline behavior and recovery behavior;
- tests, evidence and maintainer/owner.

Suggested capability families:
- **Core:** tasks, plans, sessions, memory, files via scoped handles, notifications and user approvals.
- **Diagnostics:** app lifecycle, crash reports, logs, network reachability, storage and performance measurements.
- **Connectivity:** network state, Wi-Fi status, scan/connect where OS policy allows, VPN status and captive portal diagnosis.
- **Device:** camera, microphone, location, Bluetooth, sensors, contacts, clipboard and notifications only through platform APIs, explicit permissions and narrow scopes.
- **System:** app launch, package/update state, managed services and OS settings only where a documented platform API or privileged AgentOS system service allows them.
- **Domain adapters:** RouterOS, Starlink, billing, procurement and other Br3eze-specific integrations remain plugins/adapters, not kernel/core dependencies.

A capability unavailable on a host must return a typed `unsupported` result—not a fake success, silent no-op, or fallback to unbounded shell access.

## 5. Cordova bridge contract

Keep a thin bridge:
- JavaScript API provides stable, promise-based methods.
- Native plugin validates types, size, permission state, caller context and allowed action names.
- Native plugin calls Android APIs or a narrow AgentOS platform service.
- Response uses versioned structured results: `{ ok, code, data, traceId }` (never include secrets in errors).
- Long-running actions support cancellation and explicit progress events.
- Every action has a documented permission mapping, lifecycle behavior, minimum API level and device test.
- A native result reports observed platform state; a UI state change alone is not accepted as proof.

Do not duplicate the agent loop in JavaScript plugin agents, Android services or the OS service. Those components provide native access, lifecycle, IPC, and transport. They submit work to the same AgentRuntime.

## 6. Platform debugging and maintenance skill system

The repository has a skill package convention under `skills/`, with `SKILL.md` instructions and `index.js` metadata/context factory. Add platform skills as modular packages that route tasks through AgentRuntime; a skill is not an autonomous privileged process.

Recommended packages:
- `skills/agentos-platform-debug/`: reproduce, collect redacted evidence, classify and verify fixes across PWA, Cordova, Node, desktop and OS.
- `skills/agentos-cordova-maintenance/`: config.xml, plugin contract, Android/iOS build, permissions, lifecycle, plugin upgrade and release regression.
- `skills/agentos-android-os-maintenance/`: AOSP source locks, build provenance, patch ledger, device qualification, OTA/recovery and compatibility.
- `skills/agentos-capability-audit/`: capability manifests, authorization paths, least privilege, data scope, cancellation, timeouts and revocation.

Each skill must define triggers, required context, safe read-only diagnostics, changes it may propose, approvals, test commands, evidence outputs and escalation criteria. Use one skill package per clear responsibility, but one runtime/registry for execution. The current PR introduces the platform-debug skill first; the other packages should be added only as their actual workflows are implemented.

### Debugging protocol

1. **Identify host:** PWA/browser, Cordova Android, Cordova iOS, Node gateway/CLI, desktop or AOSP/device build.
2. **Capture facts:** commit SHA, app version, OS/API level, device/OEM, runtime version, permissions, network state, reproduction steps and exact redacted error.
3. **Reproduce minimally:** one failing path, one expected result and one observed result.
4. **Trace ownership:** UI → bridge/API → runtime entry point → policy → registry → adapter → platform API.
5. **Find the first broken boundary:** don't patch the UI if the native permission is denied; don't bypass policy to make a test pass.
6. **Fix the canonical owner:** update the one module responsible, and adapt compatibility facades rather than duplicating logic.
7. **Add regression tests:** unit test for logic, integration test for bridge/entry point, emulator/device test for platform behavior.
8. **Verify adjacent platforms:** at least run relevant PWA/Node tests after core changes; test each affected Cordova platform and supported API/OEM matrix.
9. **Produce evidence:** before/after output, tests run, unsupported cases, known risks and rollback steps.
10. **Release safely:** no production release while required CI gates fail; signing credentials remain outside logs and source control.

### Diagnostic evidence bundle

A report should contain:
- issue ID, time, commit/build ID and platform;
- sanitized device/app/runtime facts;
- steps to reproduce and expected/actual behavior;
- logs with tokens, personal data, SSIDs/passwords, network credentials, file contents and identifiers redacted;
- relevant capability and policy decision IDs;
- test results and artifact hashes;
- owner, severity, fix commit, rollback plan and residual limitations.

Do not upload raw logs, transcripts, contacts, clipboard contents, location history, credentials or screenshots by default. Preview and redact before a user explicitly shares a diagnostic bundle.

## 7. Universal harness acceptance gates

### Gate 1 — Single execution owner
- Every entry point routes to the canonical AgentRuntime/ToolRegistry.
- No second model/tool loop in Cordova, Android service, PWA or plugin.
- Compatibility imports delegate rather than reimplement.

### Gate 2 — Permission and capability correctness
- Denied/unknown capabilities fail closed.
- Tenant/user/profile/resource scope comes from trusted host identity.
- Writes require explicit authorization and approval.
- Revocation applies to active sessions and future calls.
- Unsupported capability is reported honestly.

### Gate 3 — Device bridge reliability
- Invalid arguments and unapproved methods are rejected natively.
- Timeout, cancellation, app backgrounding, WebView reload, process death and permission denial are tested.
- API/OEM-specific behavior is recorded rather than hidden by compatibility shims.

### Gate 4 — Diagnostics and maintenance
- Skills produce reproducible evidence, not guesses.
- Logs are redacted; diagnostics are consent-controlled.
- Every fix adds a regression test at the owning layer.
- CI covers syntax, unit, integration, Cordova build and OS build as the respective workflows become available.

### Gate 5 — OS provenance
- Pinned source manifest, patch ledger, license review and build evidence are present.
- OTA signature, rollback, recovery and device compatibility are verified before release.
- Independent clean builds are compared before making reproducibility claims.

## 8. Implementation order

1. **Documented baseline (this file):** map actual app, runtime, plugin and OS boundaries.
2. **Platform debug skill:** create a package that produces a redacted diagnosis and test plan across supported hosts.
3. **Cordova audit:** compare declared permissions, plugin methods, app identity, SDK levels, lifecycle and hooks; add tests before changing permissions or APIs.
4. **Entry-point audit:** inventory CLI, HTTP, WebSocket, scheduled and plugin execution; route all through one authorization/registry boundary.
5. **Capability contract:** normalize host capability manifests and typed unsupported/denied results.
6. **Bridge contract:** versioned, narrow Cordova-to-native and future Binder adapters with explicit identity and cancellation.
7. **AOSP build baseline:** clean Linux build and provenance evidence.
8. **Security patch port:** one reviewed patch at a time, with tests and rollback.
9. **Device qualification:** select a supported device, vendor tree, boot chain and OTA/recovery path before hardware-specific implementation.

## References

- [AgentOS ownership map](ownership-map.md)
- [Hardware capability boundary](hardware-capability-boundary.md)
- [AgentOS mobile OS architecture](../architecture/agentos-mobile-os.md)
- [GrapheneOS feature port plan](../roadmaps/grapheneos-feature-port.md)
- [Cordova architecture](https://cordova.apache.org/docs/en/latest/guide/overview/)
- [Cordova Android lifecycle](https://cordova.apache.org/docs/en/latest/guide/platforms/android/)
- [Cordova Android plugin bridge](https://cordova.apache.org/docs/en/latest/guide/platforms/android/plugin.html)
- [Android platform architecture](https://developer.android.com/guide/platform)
- [Android app sandbox/security](https://source.android.com/docs/security/overview/app-security)
