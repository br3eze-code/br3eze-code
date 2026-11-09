/**
 * Generates a small same-origin observer for local AgentOS PWA debugging.
 * It intentionally captures error metadata only: never request/response bodies,
 * cookies, local storage, form values, or arbitrary page text.
 */
export function createBrowserDiagnosticsScript() {
  return `(()=> {
    if (window.__agentosDiagnosticsInstalled) return;
    window.__agentosDiagnosticsInstalled = true;
    const endpoint = '/__agentos/diagnostics/events';
    let sentInWindow = 0;
    let windowStartedAt = Date.now();
    const clean = (value, limit = 1200) => String(value ?? '')
      .replace(/(?:authorization\\s*[:=]\\s*bearer\\s+)[^\\s,;]+/ig, 'Authorization: [REDACTED]')
      .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|token)\\s*[:=]\\s*)[^\\s,;]+/ig, '$1[REDACTED]')
      .slice(0, limit);
    const send = (source, level, message) => {
      const now = Date.now();
      if (now - windowStartedAt > 60000) { windowStartedAt = now; sentInWindow = 0; }
      if (sentInWindow >= 30) return;
      sentInWindow += 1;
      const payload = {
        source, level, message: clean(message),
        page: location.pathname,
        timestamp: new Date().toISOString(),
        correlationId: document.querySelector('meta[name="agentos-correlation-id"]')?.content || null
      };
      try {
        void fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          credentials: 'same-origin',
          keepalive: true
        }).catch(() => {});
      } catch {}
    };
    const originalError = console.error.bind(console);
    console.error = (...args) => {
      send('browser.console', 'error', args.map((arg) => arg instanceof Error ? (arg.stack || arg.message) : String(arg)).join(' ').slice(0, 1200));
      originalError(...args);
    };
    window.addEventListener('error', (event) => {
      send('browser.runtime', 'error', event.error?.stack || event.message || 'Unhandled browser error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason instanceof Error ? (event.reason.stack || event.reason.message) : String(event.reason ?? 'Unhandled promise rejection');
      send('browser.runtime', 'error', reason);
    });
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      let safePath = 'unknown';
      try {
        const rawUrl = args[0] instanceof Request ? args[0].url : String(args[0]);
        const parsed = new URL(rawUrl, location.href);
        safePath = parsed.origin === location.origin ? parsed.pathname : parsed.origin;
      } catch {}
      try {
        const response = await originalFetch(...args);
        if (!response.ok && !safePath.startsWith(endpoint)) send('browser.network', 'error', 'HTTP ' + response.status + ' ' + safePath);
        return response;
      } catch (error) {
        if (!safePath.startsWith(endpoint)) send('browser.network', 'error', 'Fetch failed ' + safePath + ': ' + (error?.message || 'network error'));
        throw error;
      }
    };
  })();`;
}
