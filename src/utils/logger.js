// src/utils/logger.js
// ──────────────────────────────────────────────────────────────────────────────
// Bridge shim — several core modules import '../utils/logger' but the real
// implementation lives in src/core/logger.js. This file re-exports everything
// so both import paths resolve cleanly without touching each caller.
// ──────────────────────────────────────────────────────────────────────────────

'use strict';

import coreLogger from '../core/logger.js';

// Named re-exports used in the wild: { Logger }, { logger }, default
export default {
  ...coreLogger,
  // Alias: some files do `const { Logger } = require('../utils/logger')`
  Logger: coreLogger.logger
};
