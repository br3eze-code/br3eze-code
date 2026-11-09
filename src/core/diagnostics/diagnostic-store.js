export function redactDiagnosticText(value, maxLength = 2000) {
  let text = String(value ?? '');
  text = text.replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]');
  text = text.replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1[REDACTED]');
  text = text.replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret|token)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
  text = text.replace(/\b(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9_-]{8,}/gi, '[REDACTED]');
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maxLength);
}

function safePagePath(value) {
  try {
    return redactDiagnosticText(new URL(String(value || '/'), 'http://agentos.local').pathname, 300);
  } catch {
    return '';
  }
}

function normalizeEvent(input = {}) {
  const source = ['browser.console', 'browser.runtime', 'browser.network', 'browser.notification', 'browser.screen'].includes(input.source)
    ? input.source
    : 'browser.runtime';
  const level = ['error', 'warn', 'info'].includes(input.level) ? input.level : 'error';
  return Object.freeze({
    id: '',
    timestamp: Number.isFinite(Date.parse(input.timestamp)) ? new Date(input.timestamp).toISOString() : new Date().toISOString(),
    source,
    level,
    message: redactDiagnosticText(input.message),
    page: safePagePath(input.page),
    tenantId: String(input.tenantId || 'local').slice(0, 128),
    correlationId: /^[a-zA-Z0-9._:-]{1,100}$/.test(String(input.correlationId || '')) ? String(input.correlationId) : null,
  });
}

export class DiagnosticEventStore {
  constructor({ maxEvents = 200 } = {}) {
    this.maxEvents = Math.max(1, Math.min(1000, Number.parseInt(maxEvents, 10) || 200));
    this.events = [];
  }

  record(event) {
    if (!event || typeof event !== 'object') throw new TypeError('DIAGNOSTIC_EVENT_REQUIRED');
    const normalized = normalizeEvent(event);
    this.events.push(Object.freeze({ ...normalized, id: normalized.id || `diag-${Date.now().toString(36)}-${this.events.length.toString(36)}` }));
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    return this.events[this.events.length - 1];
  }

  list({ limit = 50, source = null, level = null, tenantId = null } = {}) {
    const boundedLimit = Math.max(1, Math.min(this.maxEvents, Number.parseInt(limit, 10) || 50));
    return this.events.filter((event) => (!tenantId || event.tenantId === tenantId) && (!source || event.source === source) && (!level || event.level === level))
      .slice(-boundedLimit).map((event) => ({ ...event }));
  }

  clear() {
    const removed = this.events.length;
    this.events = [];
    return removed;
  }

  get size() {
    return this.events.length;
  }
}

export const diagnosticEventStore = new DiagnosticEventStore();
