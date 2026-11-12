# GrapheneOS Feature Port Plan for AgentOS

**Status:** Source-backed feature mapping and implementation backlog. This is not a claim that GrapheneOS code has been ported or that AgentOS is a mobile operating system yet.

**Upstream feature reference:** https://grapheneos.org/features  
**AOSP baseline:** https://source.android.com/docs/security/overview  
**Target product:** an original AgentOS mobile OS based on AOSP, with carefully evaluated GrapheneOS-inspired security improvements and AgentRuntime integration.

## Decision: port the security properties, not the feature list blindly

GrapheneOS documents improvements over AOSP, including attack-surface reduction, hardened components and sandboxing, privacy controls, user/profile isolation, secure updates, browser hardening, user-controlled diagnostics, and secure infrastructure. Some are operating-system source changes, some require supported hardware or vendor integration, and some are product/service practices. They cannot all be implemented in the existing Node.js repository as JavaScript features.

This plan classifies each item as:
- **OS port:** requires an AOSP/device source workspace and Android platform changes.
- **AgentOS runtime:** can be implemented in the existing JavaScript harness without pretending it changes Android system security.
- **Mobile app:** can be prototyped in an ordinary Android app, subject to Android's existing permissions and APIs.
- **Operations:** build, update, server, release, or governance work.
- **Research/device gate:** depends on device hardware, upstream version, vendor sources, legal review, or deeper investigation.

## Feature-by-feature mapping

| Upstream feature / principle | AgentOS target behavior | Correct implementation layer | Acceptance evidence |
|---|---|---|---|
| Attack-surface reduction; optional features disabled by default | Disable unused AgentOS tools, adapters, endpoints and background services; provide explicit user-controlled toggles for capabilities | Runtime now; OS product configuration later | Default capability inventory; negative tests prove disabled capabilities cannot run |
| USB-C, Bluetooth, NFC, UWB and locked-device controls | Expose platform controls only where supported and enforce restrictions in the OS/hardware layer | OS port / device-specific | Device-level tests confirm actual hardware/API state; UI-only toggles do not count |
| Hardened app spawning, libc, allocator and kernel | Use maintained AOSP/toolchain mitigations and evaluate compatible upstream hardening patches | OS port / upstream toolchain | Patch provenance, supported architecture, build evidence, exploit-mitigation configuration and device tests |
| SELinux/seccomp and sandbox hardening | Keep AgentOS services narrowly privileged; apply explicit least-privilege policy; never grant agents root by default | OS port plus runtime policy | SELinux policy tests; denied-call tests; no broad allow rules; threat-model review |
| Verified boot and anti-persistence | Require signed production artifacts and verified boot where the target hardware supports it; define rollback and recovery behavior | OS port / device / release | Verified boot state, signature checks, rollback test, recovery and failed-update test |
| Signed system package metadata | Maintain signed, provenance-tracked AgentOS system packages and updates using supported platform mechanisms | OS port / release | Invalid signature rejected; update provenance and build revision recorded |
| Network permission toggle | Add per-agent and per-capability network access policy now; OS-wide per-app enforcement requires Android platform changes | Runtime now; OS port later | Deny direct and indirect network capability calls; test localhost/profile boundaries on device |
| Sensors permission toggle | Agent capability policy must not imply sensor permission; OS-wide sensor access requires platform integration | Runtime / OS port | Unauthorized sensor access denied at platform boundary; denied state visible to user |
| Storage Scopes | Provide scoped file handles and allowlisted paths to AgentRuntime tools; OS-compatible app storage scopes require platform work | Runtime now; OS port later | Traversal, symlink, cross-user and unauthorized-file tests |
| Contact Scopes | If contacts are integrated, expose only selected contacts/groups through a broker; no broad contacts dump | Mobile app / OS port / runtime adapter | Tests prove only selected records are returned and grants can be revoked |
| Secure Paste | Avoid collecting clipboard content automatically; require an explicit paste/action and redact secrets from agent logs | Mobile app now; OS-wide clipboard controls later | Clipboard-read permission/flow review; no background capture; secret-redaction tests |
| Private screenshots and metadata minimization | Avoid sensitive metadata in AgentOS-generated exports and diagnostic captures; system screenshot behavior requires OS changes | App/runtime now; OS port later | Export metadata tests; confirm OS screenshot metadata behavior on device |
| Device identifier leak reduction | Do not use hardware identifiers as agent identity; use scoped random app/session identifiers | Runtime/mobile app now; OS port for platform leaks | Static review and tests ensure identifiers are not collected or logged unnecessarily |
| Privacy by default; minimal bundled services | No mandatory cloud provider; local/offline operation where feasible; explicit opt-in for telemetry and integrations | Product/runtime/OS | Network egress inventory; offline tests; consent and settings tests |
| PIN scrambling / longer passphrases / two-factor fingerprint | Use supported Android credential APIs; never implement a custom credential capture screen; platform lock-screen features require OS work | OS port / device capability | Security review and hardware-specific tests; no credentials exposed to AgentRuntime |
| Auto reboot and clearing sensitive memory | Define an inactivity/locked-state policy only if implemented by trusted OS components; do not emulate secure reboot from a normal app | OS port / device-specific | Tested state transitions, data-at-rest assumptions and recovery behavior |
| Duress credentials / destructive wipe | Not part of the first AgentOS scope; any future implementation requires specialist threat modelling and careful safeguards | Research / explicit future decision | Independent design review and non-destructive test plan before implementation |
| Improved user profiles | Keep agent task history, tokens and data scoped by Android user/profile and authenticated account | OS integration + runtime | Cross-profile access denied; profile deletion/revocation behavior verified |
| Hardened browser and WebView | Use a maintained, security-updated browser/WebView; evaluate Vanadium-related changes only for compatible versions and licenses | OS port / browser integration | Browser security updates, site-isolation settings, compatibility and regression tests |
| Auditor and hardware-backed attestation | Display verified device/build status only when supported by a trustworthy attestation chain; never fake an attestation result | OS port / operations / UI | Hardware-backed verification on supported hardware and clear unsupported/error states |
| Camera and PDF Viewer | Choose maintained, minimal apps; treat GrapheneOS apps as reference implementations, not automatic dependencies | Product/app selection | Dependency, licensing, maintenance and permission review |
| Encrypted backups | Encrypt backups client-side where feasible, separate keys from backup storage, document recovery limits | Runtime/app/operations | Restore test; wrong key and tampered backup rejected; key handling reviewed |
| VPN leak blocking | Respect Android VPN lockdown and provide clear connection state; OS-level DNS/multicast protections need kernel/network stack changes | App/runtime now; OS port later | DNS, IPv4/IPv6, reconnect, multicast and tunnel-failure tests on target devices |
| Log viewer and user-controlled crash reporting | Provide opt-in diagnostic bundles with redaction and preview; no silent transcript/crash upload | Runtime/app now; OS integration later | Redaction tests, consent test, exported bundle inspection and retention policy |
| Seamless OS updates and rollback | Signed OTA with staged rollout, recovery and rollback on supported device architecture | OS port / operations | Install, interrupted update, rollback, recovery and signature rejection tests |
| Minimal bundled apps and optional alerts | Keep product image small; document every privileged package; expose supported alert preferences without breaking legal/device requirements | OS product / device | Package inventory and rationale; settings tests on supported hardware |
| Hardened server services and privacy-preserving infrastructure | Provider-neutral adapters, TLS, minimal retention, no secrets in logs, explicit telemetry, CSP and secure sessions for web interfaces | Existing backend / operations | CI security checks, configuration review, log-retention test and external security review |

## AgentOS-specific requirements derived from the feature review

These are appropriate to implement in the existing repository before an AOSP source tree exists.

1. **Capability manifest review:** every tool/skill/plugin declares its permissions, risk, network needs, data access, and whether human approval is required.
2. **Single authorization boundary:** all entry points (CLI, HTTP, WebSocket, schedules, mobile bridge and plugins) must route execution through the canonical AgentRuntime policy boundary. No second hidden orchestration loop.
3. **Least privilege by default:** optional network, filesystem, browser, device, notification and account capabilities are disabled unless explicitly configured.
4. **Scoped data access:** tools receive scoped handles and selected records, not broad filesystem/contact/notification dumps.
5. **User-controlled diagnostics:** diagnostics are previewable, redacted, opt-in for sharing, and bounded by retention policy.
6. **Local-first design:** local model/runtime and local data paths remain possible; cloud model calls and external uploads are disclosed and policy-controlled.
7. **Audit and revocation:** record who requested an action, which capability was selected, the policy decision, and verified outcome, while redacting secrets; grants can be revoked.
8. **Release provenance:** source revision, dependency inventory, build output, test report, signatures and update channel are linked for each release.
9. **No false platform claims:** a Node.js service or Cordova app cannot enforce Android-wide USB, sensor, clipboard, kernel, verified-boot, or other privileged controls. These require platform source, supported hardware, and device-level tests.

## Implementation order

### Phase A — Current repository (Node.js / web / app integration)
- Add a capability security inventory and manifest validation.
- Audit every production execution entry point for one authorization boundary.
- Add tests for disabled network access, scoped file access, redaction, approval and revocation.
- Add a user-controlled diagnostic export and retention contract.
- Document which controls are app-level versus OS-level.

**Gate:** CI demonstrates that unauthorized capabilities are denied on all supported runtime entry points.

### Phase B — Android app integration prototype
- Implement a non-privileged Android client that displays permission explanations, agent activity, pending approvals and diagnostic controls.
- Use supported Android APIs only; do not request root or Accessibility access to imitate OS integration.
- Define a versioned bridge contract to AgentRuntime with authenticated caller identity and cancellation.

**Gate:** Android client cannot bypass AgentRuntime policy; permission and profile boundaries are tested.

### Phase C — AOSP OS workspace and device baseline
- Choose the first supported device and pinned AOSP revision.
- Build and boot an unmodified baseline.
- Track GrapheneOS feature/patch provenance, upstream revision, license, hardware dependencies, tests and compatibility risks.
- Port compatible changes individually; maintain a patch ledger.

**Gate:** baseline build and boot are reproducible and target device is supported.

### Phase D — Platform security port
- Implement platform-only controls such as privileged permission changes, SELinux/seccomp hardening, system service integration, update integrity and hardware-specific features.
- Validate each feature on device and ensure Android compatibility is not silently broken.

**Gate:** each claimed control has a test, device matrix, known limitations and review evidence.

### Phase E — AgentOS mobile release
- Sign builds, establish OTA and recovery, publish support/update policy, and complete privacy/security review.
- Release only for explicitly qualified devices.

**Gate:** security, compatibility, recovery and update criteria pass on the same release revision.

## Patch ledger template

Every proposed upstream port must record:

- Feature and security property
- Upstream source URL and exact commit/tag
- License and attribution requirements
- AOSP base revision and target device(s)
- Files changed and patch delta
- Threat addressed and expected effect
- Build, unit, integration and device test evidence
- Compatibility/performance impact
- Rollback path and upstream maintenance owner
- Status: proposed / investigating / ported / tested / rejected

## Source and attribution

GrapheneOS feature reference: https://grapheneos.org/features  
GrapheneOS source organization: https://github.com/GrapheneOS  
AOSP security overview: https://source.android.com/docs/security/overview  
Android app sandbox: https://source.android.com/docs/security/app-sandbox  
Android Verified Boot: https://source.android.com/docs/security/features/verifiedboot  
Android compatibility overview: https://source.android.com/docs/compatibility/overview

Use source code only after reviewing its applicable license and provenance. This plan reuses high-level engineering ideas; it does not copy GrapheneOS branding or imply affiliation or endorsement.

## Current status

- [x] Reviewed the official GrapheneOS features overview.
- [x] Mapped major documented features to a responsible AgentOS layer.
- [x] Separated runtime/app work from privileged OS and hardware work.
- [ ] Implement capability manifest and authorization audit in code.
- [ ] Select and build the first AOSP/device baseline.
- [ ] Port and verify any individual GrapheneOS-derived code changes.

**Do not call AgentOS GrapheneOS-hardened or production-secure until the actual platform changes have been built and verified on supported hardware.**
