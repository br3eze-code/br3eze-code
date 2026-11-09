# AgentOS Diagnostic Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add redacted browser-error observation and canonical AgentRuntime diagnostic tools, with explicit adapter hooks for screen capture and OS notifications.

**Architecture:** The existing Gateway injects a same-origin observer only in local development and stores events in a bounded in-memory store. AgentRuntime registers diagnostic tools into its existing ToolRegistry; optional platform providers supply screen capture or OS notification access without adding another runtime.

**Tech Stack:** Node.js ESM, Express, Jest, Supertest.

**Spec:** `docs/architecture/diagnostic-observation.md`

## Global Constraints

- AgentRuntime is the single execution owner.
- Browser diagnostic ingestion is enabled only on loopback development gateways.
- Never capture request/response bodies, cookies, local storage, form values, or arbitrary page text.
- Redact common credentials before storing event text.
- Screen capture and OS notification access require an explicitly supplied provider and approval.

## Review Focus

- Secrets embedded in error text must be redacted before retention — covered by the store tests.
- One tenant must not read another tenant's observations — covered by the diagnostic tool tests.
- Diagnostic event floods must remain bounded — covered by the store tests.
- The observer must not recursively report its own failed ingestion request — excluded by endpoint path in the browser observer.
- Non-loopback listeners must not expose ingestion — covered by the gateway tests.
- Missing platform providers must report unavailable rather than pretending to capture — covered by diagnostic tool tests.

---

### Task 1: Store and tool contract

**Files:**
- Create: `src/core/diagnostics/diagnostic-store.js`
- Create: `src/core/diagnostics/diagnostic-tools.js`
- Test: `tests/unit/diagnostic-observation.test.js`

- [x] Define redaction, bounded event retention, and the diagnostic tool contract.
- [ ] Run focused tests and verify redaction and provider-unavailable behavior.

### Task 2: Browser observer and gateway ingestion

**Files:**
- Create: `src/adapters/diagnostics/browser-observer.js`
- Modify: `src/core/live-web-server.js`
- Modify: `src/core/gateway-engine.js`
- Test: `tests/unit/diagnostic-gateway.test.js`

- [x] Inject local-only observer script and add bounded JSON event ingestion.
- [ ] Run focused gateway tests, including non-loopback rejection.

### Task 3: Canonical runtime registration

**Files:**
- Modify: `src/core/agentRuntime.js`

- [x] Register diagnostics through the existing ToolRegistry when not already present.
- [ ] Run runtime tests and the complete repository suite.

### Task 4: Review and integration

- [ ] Inspect the full branch diff and run architecture/security checks.
- [ ] Open a pull request and verify its CI results before merging.
