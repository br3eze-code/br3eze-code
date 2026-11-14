# AgentOS Browser Screen and Notification Diagnostics Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local, on-demand browser screen capture and permission-aware browser notification diagnostics without adding another runtime or gateway.

**Architecture:** The existing Gateway serves the same-origin observer and owns all diagnostic HTTP routes. A browser adapter requests screen sharing only after a user clicks a local capture button, then sends a bounded image to a process-local capture store. The existing AgentRuntime registers tools that read capture metadata and redacted browser notification events; operating-system notification enumeration remains unsupported.

**Tech Stack:** Node.js ESM, Express Gateway, browser Screen Capture API, Jest, Supertest.

**Spec:** `docs/architecture/diagnostic-observation.md`

## Global Constraints

- One AgentRuntime owns tool execution.
- One Gateway owns HTTP routes and listener lifecycle.
- Browser capture requires an explicit user gesture and the browser's native screen-sharing permission picker.
- No screenshot or notification data is sent to third-party services.
- Capture data remains in bounded process memory and is not persisted.
- Do not collect notification body text, request/response bodies, cookies, local storage, form values, or URL query strings.
- Operating-system notification enumeration is not claimed or implemented.
- Production and non-loopback listeners do not expose diagnostic routes or inject the observer.

## Review Focus

- Capture request is denied or unavailable when the user cancels the browser permission picker.
- Invalid, oversized, or non-image capture payloads are rejected before storage.
- Capture and notification data are isolated by server-assigned tenant scope.
- Browser Notification API is absent or permission is not granted.
- Observer's own diagnostic requests fail without causing an event loop.

---

### Task 1: Bounded capture store and browser observation provider

**Files:**
- Create: `src/core/diagnostics/diagnostic-capture-store.js`
- Create: `src/adapters/diagnostics/browser-observation-provider.js`
- Test: `tests/unit/diagnostic-capture.test.js`

- [ ] Write failing tests for size/type validation, tenant isolation, in-memory latest capture, notification event filtering, and no OS-notification claims.
- [ ] Run the focused test and confirm it fails because the provider/store is missing.
- [ ] Implement a bounded capture store and a provider that reads local capture metadata and redacted browser notification events.
- [ ] Run the focused test and confirm it passes.

### Task 2: User-initiated browser capture and notification monitoring

**Files:**
- Modify: `src/adapters/diagnostics/browser-observer.js`
- Modify: `tests/unit/diagnostic-observation.test.js`

- [ ] Add tests for the user-gesture capture button, native `getDisplayMedia` permission flow, image-size bounds, and browser Notification API observation without notification body capture.
- [ ] Run focused tests and confirm they fail for the expected missing behavior.
- [ ] Add the local capture button, cap screenshot dimensions/quality, stop capture tracks immediately, and post only image data plus safe metadata to the same-origin Gateway.
- [ ] Observe in-page error alerts and page-created browser notifications only; never request notification permission automatically.
- [ ] Run focused tests and confirm they pass.

### Task 3: Gateway routes and runtime integration

**Files:**
- Modify: `src/core/gateway-engine.js`
- Modify: `src/core/diagnostics/diagnostic-tools.js`
- Modify: `src/core/agentRuntime.js`
- Modify: `tests/unit/diagnostic-gateway.test.js`
- Test: `tests/unit/diagnostic-capture.test.js`

- [ ] Add failing tests for local-only capture ingestion, MIME/size validation, latest capture preview, tenant scoping, and disabled production/non-loopback access.
- [ ] Run focused tests and confirm the expected failures.
- [ ] Add Gateway-owned capture routes, reuse the process-local stores, and inject the browser provider into the existing AgentRuntime by default while preserving explicit host overrides.
- [ ] Make `diagnostics.capture` return safe metadata and a local preview path; make `diagnostics.notifications` read redacted browser notification events. Keep OS notification access explicitly unsupported.
- [ ] Run focused tests and confirm they pass.

### Task 4: Verify and document

**Files:**
- Modify: `docs/architecture/diagnostic-observation.md`
- Modify: `docs/troubleshooting/diagnostic-observation.md`

- [ ] Document user gesture, browser permission, cancellation behavior, data retention, notification limits, and troubleshooting.
- [ ] Run the focused tests, repository test command, architecture gate, and CI quality gates.
- [ ] Review the branch diff for duplicate owners, data leakage, and production exposure. Do not merge while required checks are red.
