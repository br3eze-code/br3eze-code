# AgentOS Diagnostic Observation

## Intent

Let the existing AgentRuntime diagnose localhost PWA failures by reading structured browser errors and correlate them with the same process's diagnostic event store. Keep platform-specific screen capture and operating-system notification access behind optional, permissioned observation providers.

## Architecture decisions

- AgentRuntime remains the single execution owner; diagnostic capabilities are registered in the existing ToolRegistry.
- The Gateway owns the HTTP routes and listener. The live-web-server is Gateway middleware; it serves local pages and injects the observer in development.
- A bounded in-memory DiagnosticEventStore is the source of truth for browser observations within the process. Events are not persisted by default.
- Browser observation records console errors, unhandled exceptions/rejections, failed fetch metadata, and visible in-page error alerts/toasts. It never records request/response bodies, cookies, local storage, form values, or query strings from network URLs.
- The store redacts common credentials before retaining event text, caps event size/count, and filters reads by server-assigned tenant scope.
- Ingestion is enabled only for the development live server on a loopback listener. Production and non-loopback listeners return 404 for diagnostic ingestion.
- The local PWA exposes an on-demand capture button. A click opens the browser's native screen-share picker; the user can cancel. The selected frame is downscaled, sent to the same-origin Gateway, and retained in bounded process memory only.
- Browser notification diagnostics observe visible in-page error alerts and page-created Notification API events only after browser permission is already granted. Notification bodies are never read. Operating-system notification tray enumeration is not supported.
- The capture tool returns metadata for a user-approved capture and a local preview path; it does not silently start screen sharing. The notification tool reads redacted browser notification events and visible alerts. Both remain subject to the existing runtime's permission gate.

## Tools

- `diagnostics.capabilities`: report supported observation sources.
- `diagnostics.events`: return recent redacted browser events with optional source/level filters.
- `diagnostics.capture`: request a screen capture from an approved provider.
- `diagnostics.notifications`: read notifications from an approved provider.

## Non-goals in this slice

- No automatic screen capture or browser notification permission request.
- No desktop/Android operating-system notification tray access.
- No OCR/model inference on screenshots.
- No remote diagnostic ingestion, persistent event database, or upload of diagnostic evidence to third-party model providers.
- No autonomous code edits from a notification alone. The runtime must correlate evidence and use its normal approval and verification gates.

## Verification

Run the focused tests and the repository test suite. Verify development localhost injects the observer, user-approved capture data is bounded and tenant-scoped, the preview is not cached, browser notification bodies are excluded, malformed input is rejected, and production/non-loopback listeners do not expose diagnostic routes.
