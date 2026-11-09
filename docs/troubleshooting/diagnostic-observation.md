# Troubleshoot local AgentOS diagnostics

## Start the observer

1. Start AgentOS in development mode.
2. Bind the Gateway to `127.0.0.1` or `localhost`.
3. Open the local PWA or the Gateway dashboard.
4. Reproduce the error.
5. Read recent events with `diagnostics.events`.

The observer records browser console errors, unhandled exceptions, failed HTTP request metadata, and visible in-page error alerts. It does not record request or response bodies.

## Check the observer

1. Open `/__agentos/diagnostics/capabilities` on the same local origin.
2. Confirm that `browserEvents` is `true`.
3. Open the browser developer tools.
4. Check the Console and Network panels.
5. Reproduce the error and check `diagnostics.events` again.

## If no events appear

- Confirm that the Gateway runs in development mode.
- Confirm that the listener uses a loopback address.
- Confirm that the page came from the same Gateway.
- Check whether the browser blocked the event request.
- Check whether the event limit was reached.

The observer stops after 30 reports per browser minute. This limit reduces repeated error reports.

## Screen capture and operating-system notifications

The browser observer cannot read operating-system notifications. Screen capture and notification access need a platform provider with the required permissions. If no provider is available, AgentOS reports that the capability is unavailable.

Do not copy credentials, private messages, or unrelated personal information into diagnostic reports. The observer removes common credential patterns, but redaction cannot detect every secret.

## Production boundary

The Gateway does not inject the observer or expose the diagnostic ingestion endpoint in production. Do not enable local diagnostics on a public listener.
