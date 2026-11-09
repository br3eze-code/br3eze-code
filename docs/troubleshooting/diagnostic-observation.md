# Troubleshoot local AgentOS diagnostics

## Monitor browser errors

1. Start AgentOS in development mode on \`127.0.0.1\` or \`localhost\`.
2. Open the local PWA or Gateway dashboard.
3. Open browser DevTools. Check Console and Network.
4. Reproduce the failure.
5. Read recent redacted events with \`diagnostics.events\`.

The observer records console errors, unhandled exceptions, failed Fetch/XHR requests, failed page resources, and visible in-page error alerts. It does not record request or response bodies.

## Capture a screen

1. Click **Capture screen for diagnostics** in the local page.
2. Select a screen, window, or tab in the browser's native permission prompt.
3. Cancel the prompt if the selected content is not safe to share.
4. Open **Open latest capture** to view the image.
5. Ask AgentOS to read \`diagnostics.capture\` for the capture time, size, and local preview path.

The browser controls permission. AgentOS cannot bypass the browser's screen-share prompt. The capture is reduced to at most 1280 by 720 pixels and stored in process memory. The latest capture replaces the previous capture for the same tenant. A process restart removes captures.

## Diagnose browser notifications

The observer reads titles and tags from page-created browser notifications only when the browser has already granted notification permission. It does not request permission. It never reads notification body text.

The observer also records visible in-page error alerts and toast messages. This does not provide access to the operating-system notification tray. Desktop notification history is not available through standard browser APIs.

Use \`diagnostics.notifications\` to read redacted browser notification events. Use \`diagnostics.events\` with the \`browser.notification\` source to review in-page alerts.

## If no events appear

- Confirm that the Gateway runs in development mode.
- Confirm that the listener uses a loopback address.
- Confirm that the page came from the same Gateway.
- Check whether the browser blocked the event request.
- Check whether the event limit was reached.
- Confirm that the page-created notification permission is already granted if you expect Notification API events.

The observer stops after 30 reports per browser minute. It excludes diagnostic event and capture requests from its own network error monitoring.

## Privacy and production

Screenshots can contain sensitive content. Capture only the screen or window needed for debugging. The screenshot stays in process memory and is not uploaded to a model provider. Common credential patterns are redacted from text events, but redaction cannot detect every secret.

The Gateway does not inject the observer or expose diagnostic routes in production or on a non-loopback listener.
