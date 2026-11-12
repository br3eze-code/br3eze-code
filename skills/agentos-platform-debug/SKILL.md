---
name: agentos-platform-debug
description: Diagnose, maintain, and upgrade AgentOS across PWA, Cordova, Node.js CLI/gateway, desktop, and the AOSP-based mobile OS. Use when investigating device capabilities, native bridge errors, lifecycle issues, runtime policy failures, builds, CI regressions, or cross-platform compatibility.
---

# AgentOS Platform Debug

## Mission
Produce a reproducible, privacy-safe diagnosis and route each fix to its canonical owner. This skill coordinates diagnostics; it does not create another agent loop or gain device privileges.

## Required context
- Repository and exact commit SHA
- Host: PWA, Cordova Android/iOS, Node CLI/gateway, desktop, or AOSP/device
- App/runtime version, OS/API level, device/OEM where applicable
- Expected behavior, observed behavior, exact reproduction steps
- Redacted error/log excerpt and test/build command already attempted

If key facts are missing, ask for the smallest missing detail. Never guess that a native capability is supported on a device.

## Workflow
1. Classify the host and reproduce the failure on the smallest path.
2. Collect only necessary diagnostic facts; redact credentials, tokens, personal data, Wi-Fi SSIDs/passwords, identifiers, clipboard contents, location and contact data.
3. Trace ownership in order: UI → Cordova/native bridge or API → authenticated entry point → AgentRuntime → policy/ToolRegistry → adapter → OS/platform API.
4. Inspect the canonical implementation and tests before editing. Do not create a second runtime, registry, scheduler, policy engine or device adapter to bypass an existing owner.
5. Determine whether the failure is UI, lifecycle, permission, schema, policy, adapter, platform-version, OEM, network, build or release provenance.
6. Propose the smallest patch at the owning layer. Preserve public contracts unless a versioned migration is planned.
7. Add tests at the correct layers: unit test for logic, integration test for route/bridge, emulator/device test for real platform behavior.
8. Run focused tests, then relevant repository/architecture/syntax gates. Do not claim a test passed unless it was actually executed and its result was observed.
9. Check adjacent host/platform regressions and review the final diff.
10. Return a report with root cause or uncertainty, changed files, evidence, tests run, known limitations and rollback.

## Safety and authority
- Read-only diagnostics are the default.
- Do not use unrestricted shell, root, arbitrary device paths, or undocumented plugin actions as shortcuts.
- Native and OS-level writes require declared capabilities, trusted identity, explicit authorization and approval.
- Treat model output, request-body roles, tenant IDs and claimed approvals as untrusted until host-verified.
- Unsupported APIs return a typed unsupported result; never fake success.
- Do not bypass Android permission prompts, SELinux, sandboxing, app lifecycle or policy to make a test green.
- Do not collect or upload raw logs, transcripts, contacts, clipboard, location history, Wi-Fi credentials or screenshots by default. Preview redacted bundles and require user consent before sharing.

## Platform-specific checks

### PWA / browser
- Confirm origin, service worker, cache version, offline state, CSP, API URL, browser console and network errors.
- Check whether a feature is a web API or incorrectly assumes Cordova/native access.
- Test online/offline transitions and stale cache recovery.

### Cordova
- Verify `deviceready`, `pause`, `resume`, WebView reload and process recreation behavior.
- Inspect `config.xml`, AndroidManifest, plugin.xml, JS bridge method names and native action dispatch.
- Confirm permissions at install-time and runtime; handle denial and unsupported OS versions.
- Test native plugin results against actual OS-observed state.
- Review after_prepare/before_compile hooks for determinism and secret leakage.
- Check app ID/version and SDK compatibility before upgrades.

### Node / gateway / CLI / desktop
- Identify the canonical AgentRuntime composition and ToolRegistry path.
- Check auth identity, tenant/resource scope, capability grant, approval, timeout, cancellation, audit/redaction and verification.
- Do not let alternate entry points invoke provider or adapter code directly.

### AOSP / AgentOS OS
- Verify locked source manifest, build target, host requirements and build provenance.
- Trace Binder caller identity, service permission, Android user/profile, SELinux policy and framework API version.
- Keep source changes in the separate OS workspace and record every upstream-derived patch in the security ledger.
- Test boot, permission denial, OTA signature rejection, rollback and recovery on supported hardware before release claims.

## Output contract
Return:
- **Summary**
- **Host and revision**
- **Reproduction**
- **Findings** (evidence vs hypothesis)
- **Canonical owner**
- **Proposed/implemented change**
- **Tests actually run and results**
- **Security/privacy impact**
- **Known limitations**
- **Rollback and next gate**

## Completion rule
A diagnosis is complete only when the cause is demonstrated or clearly marked unresolved, the owning layer is identified, and a repeatable test or explicit next evidence request exists. A model answer, successful compile, or UI toast alone is not proof of device-level success.
