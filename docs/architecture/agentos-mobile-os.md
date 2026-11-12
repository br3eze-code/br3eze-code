# AgentOS Mobile Operating System Architecture

**Status:** Architecture proposal; no mobile OS port or bootable image is claimed.
**Goal:** Build an original AgentOS mobile operating system using the Android Open Source Project (AOSP) as the compatibility foundation and applying independently evaluated security principles demonstrated by GrapheneOS.

AgentOS is its own product and integration architecture. It is not an official Google or GrapheneOS project, and it must not imply endorsement by either project.

## 1. The engineering decision

Do not attempt to merge two complete operating systems as if they were interchangeable code libraries. Start from a pinned AOSP release and maintain an AgentOS product/device configuration. Study GrapheneOS patches, documentation, tests, and build practices as a security reference. Port an individual change only after checking its upstream source, license, dependencies, target devices, threat model, and regression tests.

- **AOSP** supplies the Android framework, app runtime, system services, build system, and compatibility foundation.
- **GrapheneOS research and source** inform security requirements and candidate hardening changes. GrapheneOS-specific patches may depend on its supported devices, upstream versions, or build assumptions; they are not automatically portable.
- **AgentOS** owns the agent platform, policy model, user experience, service integration, product configuration, release process, and long-term maintenance.

Official references:
- AOSP source/build overview: https://source.android.com/docs/setup/about
- AOSP build instructions: https://source.android.com/docs/setup/build/building
- Android security overview: https://source.android.com/docs/security/overview
- Android application sandbox: https://source.android.com/docs/security/app-sandbox
- Android Verified Boot: https://source.android.com/docs/security/features/verifiedboot
- Android compatibility program: https://source.android.com/docs/compatibility/overview
- GrapheneOS project: https://grapheneos.org/
- GrapheneOS source organisation: https://github.com/GrapheneOS
- GrapheneOS Vanadium source: https://github.com/GrapheneOS/Vanadium
- GrapheneOS hardened_malloc source: https://github.com/GrapheneOS/hardened_malloc

These references are starting points for an evidence-backed port, not proof that every upstream feature is suitable for AgentOS.

## 2. System architecture

```text
                 AgentOS user experience
  Launcher | voice | task timeline | privacy dashboard
                           |
              AgentOS system integration API
                           |
        +------------------+------------------+
        |                                     |
  AgentRuntime client                 Policy / approval UI
        |                                     |
        +---------- Binder / IPC -------------+
                           |
              AgentOS system service
      identity | scopes | budgets | audit | consent
                           |
             Android framework services
   PackageManager | permissions | jobs | notifications
                           |
            Android app/runtime boundary
        per-app UID | SELinux | sandbox | IPC
                           |
          Linux kernel + device/vendor HALs
                           |
  Verified boot | signed updates | hardware-backed keys
                           |
                       Hardware
```

### Layer responsibilities

1. **Hardware and boot chain:** supported bootloader, hardware-backed key storage where available, verified boot chain, rollback protection where supported, and documented recovery path.
2. **Kernel and vendor interface:** pinned kernel/vendor baseline, required device drivers and HALs, SELinux enforcement, and a tracked patch set. Do not assume one generic image boots on every Android device.
3. **Android platform:** AOSP framework, ART, PackageManager, system services, permissions, app lifecycle, and compatibility requirements.
4. **Security hardening:** least privilege, attack-surface reduction, memory safety improvements where portable, hardened defaults, secure update design, and testable security properties.
5. **AgentOS system service:** a narrow Binder-facing service that accepts authenticated requests and routes approved work to the existing AgentRuntime host. It is not a second planner or execution loop.
6. **AgentRuntime:** remains the single execution owner for planning, capability selection, authorization, bounded execution, observation, and verification. Mobile UI, voice input, schedules, and system events are clients—not competing runtimes.
7. **User experience:** launcher surfaces, agent activity timeline, permission prompts, privacy controls, offline/online status, and explicit controls to stop or revoke agent access.

## 3. Agent security contract

The model is an untrusted proposer of actions, not a security authority. Every agent-initiated operation must pass through the same policy boundary.

1. Authenticate the calling app, user/profile, and session.
2. Resolve the requested capability from an allowlisted registry.
3. Check permissions, target, scope, risk, user/profile boundary, and resource budgets.
4. Require user confirmation for sensitive or externally visible actions.
5. Execute through the canonical AgentRuntime and a narrow Android/system adapter.
6. Redact sensitive output and write a structured audit event.
7. Verify the observed outcome against acceptance criteria.
8. Return a result that distinguishes success, failure, denial, timeout, and pending approval.

### Non-negotiable boundaries

- No unrestricted root or shell access for the model, agent plugins, or ordinary apps.
- No bypass of Android app sandboxing, SELinux, PackageManager, or user/profile isolation.
- No silent granting of Android runtime permissions.
- No reading screen contents, notifications, contacts, messages, microphone, camera, or location without a clear platform permission and applicable user consent.
- No arbitrary accessibility-service automation as a substitute for a supported API.
- No network permission or cloud upload by default for local/private agent data.
- High-risk actions (credential changes, purchases, deletion, device reset, security setting changes, or sending external messages) require explicit policy and approval.
- Emergency stop and per-capability revocation must work without relying on the model.

## 4. Android and GrapheneOS pattern mapping

| Reference pattern | AgentOS design response | Porting rule |
|---|---|---|
| Android per-app UID sandbox | Keep each app under Android's established isolation model; give the agent service a distinct identity | Never collapse apps into a shared privileged identity |
| SELinux mandatory access control | Add narrowly scoped service domains and policies where required | Start enforcing; test denials and avoid broad allow rules |
| Verified Boot and signed OTA | Build a signed, traceable release pipeline with rollback strategy | Device-specific implementation; validate on actual hardware |
| Permission controls and user profiles | Model, app, profile, and agent scopes are separate; approvals are revocable | Enforce at the service/API boundary, not only in prompts |
| GrapheneOS attack-surface reduction | Disable unnecessary AgentOS services and capabilities in product builds | Measure compatibility and maintain a documented exception list |
| Hardened memory / compiler protections | Enable supported toolchain and platform mitigations; assess portable upstream changes | Verify compiler, architecture, performance, and licensing compatibility |
| Secure browser and app foundations | Prefer platform APIs and maintained, audited components | Do not copy a component without dependency and update ownership |
| Auditable changes and reproducible release practices | Pin upstream revisions, record patch provenance, sign artifacts, and retain build evidence | A build passing once is not sufficient evidence of reproducibility |

This table is a porting plan, not a claim that these controls have already been implemented in this repository.

## 5. Integration with the existing AgentOS repository

The current repository is a Node.js AgentOS harness. It is not an Android OS source tree. Keep the distinction explicit:

- **Existing AgentOS runtime:** remains the authoritative orchestration and authorization owner.
- **Android integration adapter:** translates Android intents, approved Binder calls, lifecycle events, and app-facing requests into the existing runtime's public contract.
- **AgentOS Android system service:** a small, separately built Android-side component that authenticates callers and applies platform policy before requesting runtime work.
- **AgentOS mobile app/UI:** ordinary unprivileged app wherever possible; it displays consent and activity but does not become a privileged back door.
- **AOSP product source:** a separate source/build workspace with pinned upstream manifests and its own build/test/release workflow. Do not vendor the entire AOSP tree into this Node.js repository.
- **GrapheneOS references:** tracked as upstream links and patch-review records. Copy or adapt code only with license and provenance recorded.

Recommended future repository layout:

```text
agentos-mobile/
  README.md
  manifests/                 # pinned AOSP manifest / repo manifest
  device/                    # device-specific product configuration
  product/                   # AgentOS product packages and overlays
  security/
    threat-model.md
    patch-ledger.md
    permissions-policy.md
  system-service/            # Android-side Binder service
  integration/               # AgentRuntime protocol/client adapter
  tests/
    policy/
    compatibility/
    security/
    end-to-end/
  release/
    signing-and-ota.md
```

This is a proposed separate workspace, not a statement that these directories currently exist.

## 6. Delivery phases and gates

### Phase 0 — Feasibility and threat model
- Choose the first device family and exact hardware target.
- Pin an AOSP release and review its device/vendor requirements.
- Decide whether the first milestone is an emulator image or a physical device.
- Define attacker model, privacy guarantees, update ownership, support window, and recovery strategy.
- Create a patch ledger for every proposed GrapheneOS-derived or independently authored hardening change.

**Gate:** approved device, build host requirements, upstream baseline, threat model, and licensing review.

### Phase 1 — Reproducible AOSP baseline
- Build an unmodified supported AOSP target first.
- Record manifest revisions, build commands, toolchain versions, artifact hashes, and build logs.
- Boot the image in the emulator or target device and run baseline compatibility checks.
- Keep AgentOS branding and product overlays separate from upstream source changes.

**Gate:** clean baseline build and repeatable boot; no agent privileges yet.

### Phase 2 — AgentOS product shell
- Add product branding, launcher/UI, app defaults, and privacy dashboard.
- Keep ordinary UI components unprivileged.
- Establish signing, OTA/update, recovery, and security-update ownership before distributing images.

**Gate:** signed test image, upgrade/recovery test, and no weakened platform security defaults.

### Phase 3 — Hardened platform
- Review Android security documentation and selected GrapheneOS changes one by one.
- Port only changes that apply to the chosen AOSP revision and hardware.
- Add policy tests, negative tests, SELinux validation, compatibility tests, and documented exceptions.
- Track each change's source, license, rationale, test evidence, and upstream updates.

**Gate:** every hardening claim maps to a patch or configuration and a passing test or explicit device limitation.

### Phase 4 — Agent system service
- Define a narrow, versioned Binder/API contract.
- Implement caller identity, scoped capabilities, consent UI, rate/time/budget limits, audit logging, cancellation, and revocation.
- Bridge requests to the existing AgentRuntime; do not implement a second agent loop in Java/Kotlin.
- Keep cloud model providers optional and make data-flow visibility explicit.

**Gate:** unauthorized calls denied; sensitive calls require approval; cancellation/revocation tests pass; audit logs are redacted.

### Phase 5 — Device and release qualification
- Run app compatibility, boot/update/recovery, permission, privacy, performance, battery, network, and security regression tests.
- Validate camera, telephony, Wi-Fi, Bluetooth, GPS, biometrics, NFC, and vendor-specific components as applicable.
- Publish supported devices, known limitations, update cadence, signing-key custody, and incident response process.

**Gate:** signed release candidate boots and upgrades on each explicitly supported device, with a reviewed security and compatibility report.

## 7. CI and acceptance criteria

A change is not complete because it compiles. Each phase must preserve evidence.

- Source manifest and patch ledger are pinned and reviewable.
- Build logs and artifact hashes are retained.
- Agent policy unit tests cover allowed, denied, expired, cross-profile, and revoked permissions.
- Integration tests prove every Android entry point routes through the same AgentRuntime authorization boundary.
- Tests prove UI, voice, jobs, and external events cannot bypass the runtime.
- Sensitive outputs and secrets are absent from logs and crash reports.
- OTA signature, rollback, recovery, and failed-update behavior are tested on the target device.
- App compatibility and security regression results are attached to the release.
- The same commit/revision is identified for source, tests, and built artifacts.

## 8. Risks and honest limits

- Building a mobile OS is a substantial ongoing engineering and security-maintenance commitment, not a Cordova app packaging task.
- AOSP device support depends on vendor code, kernel sources, firmware, bootloader policy, and hardware-specific integration.
- GrapheneOS security work is not universally portable; some changes depend on particular devices, upstream revisions, or GrapheneOS-specific infrastructure.
- Android compatibility and strong hardening can conflict; every exception needs evidence and a clear owner.
- An agent OS increases the consequences of permission mistakes. Do not grant broad privileges merely to make demos work.
- AOSP and third-party components have different licenses and attribution requirements. Review each copied or adapted patch before distribution.
- Google Play certification, Google Mobile Services licensing, and Android trademark use are separate from building an AOSP-derived OS. Do not imply that an AOSP build is Google-certified.
- No security, privacy, compatibility, reproducibility, or production-readiness claim is valid until demonstrated on a named revision and supported device.

## 9. First concrete implementation task

Before writing Android system code, produce a reviewed Phase 0 decision record containing:
1. first target device and whether it is emulator-first;
2. pinned AOSP release and supported device tree;
3. required build environment and reproducibility plan;
4. AgentRuntime-to-Android API boundary;
5. initial threat model and permission matrix;
6. security patch ledger and license review process;
7. measurable Phase 1 acceptance tests.

**Architecture invariant:** one AgentRuntime execution owner; Android provides the secure platform and integration surface; security decisions are enforced outside the model; device-specific code stays at the platform edge.
