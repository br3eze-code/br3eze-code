import { logger, correlationIdMiddleware, asyncLocalStorage } from '../core/logger.js';

// src/utils/logger.js
// ──────────────────────────────────────────────────────────────────────────────
// Bridge shim — several core modules import '../utils/logger' but the real
// implementation lives in src/core/logger.js. This file re-exports everything
// so both import paths resolve cleanly without touching each caller.
// ──────────────────────────────────────────────────────────────────────────────

// Named re-exports used in the wild: { Logger }, { logger }, default
// `Logger` is a constructible scoped wrapper (`new Logger('ScopeName')`) used
// by several modules that expect a per-instance logger, delegating to the
// shared winston `logger` with the scope name prefixed onto each message.
class Logger {
  constructor(scope = '') {
    this.scope = scope;
  }

  _prefix(msg) {
    return this.scope ? `[${this.scope}] ${msg}` : msg;
  }
}

for (const level of ['info', 'warn', 'error', 'debug', 'success', 'cyber', 'fatal', 'trace', 'audit']) {
  Logger.prototype[level] = function (msg, ...args) {
    if (typeof logger[level] !== 'function') return;
    return logger[level](this._prefix(msg), ...args);
  };
}

export { logger, Logger, correlationIdMiddleware, asyncLocalStorage };
export default { logger, Logger, correlationIdMiddleware, asyncLocalStorage };