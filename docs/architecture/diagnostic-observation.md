# AgentOS Diagnostic Observation

## Intent

Let the existing AgentRuntime diagnose localhost PWA failures by reading structured browser errors and correlate them with the same process's diagnostic event store. Keep platform-specific screen capture and operating-system notification access behind optional, permissioned observation providers.

## Architecture decisions

- AgentRuntime remains the single execution owner; diagnostic capabilities are registered in the existing ToolRegistry.
- The Gateway/live-web-server remains the owner of the localhost HTTP surface and serves the development observer from the same origin.
- A bounded in-memory DiagnosticEventStore is the source of truth for browser observations within the process. Events are not persisted by default.
- Browser observation records console errors, unhandled exceptions/rejections, and failed fetch metadata. It never records request/response bodies, cookies, local storage, form values, or query strings from network URLs.
- The store redacts common credentials before retaining event text and caps event size/count.
- Ingestion is enabled only for the development live server on a loopback listener. Production and non-loopback listeners return 404 for diagnostic ingestion.
- Screen capture and OS notification tools fail closed and report unavailable until a platform adapter explicitly advertises the capability. Browser JavaScript cannot enumerate arbitrary OS notifications.
- Capture and OS notification tools require approval. Reading already-redacted browser error events is read-only.

## Tools

- `diagnostics.capabilities`: report supported observation sources.
- `diagnostics.events`: return recent redacted browser events with optional source/level filters.
- `diagnostics.capture`: request a screen capture from an approved provider.
- `diagnostics.notifications`: read notifications from an approved provider.

## Non-goals in this slice

- No automatic desktop/Android screen capture or notification permission grant.
- No OCR/model inference on screenshots.
- No remote diagnostic ingestion, persistent event database, or upload of diagnostic evidence to third-party model providers.
- No autonomous code edits from a notification alone. The runtime must correlate evidence and use its normal approval and verification gates.

## Verification

Run the focused tests and the repository test suite. Verify development localhost injects the observer and accepts redacted event metadata, malformed input is rejected, and non-loopback listeners do not expose the ingestion endpoint.
