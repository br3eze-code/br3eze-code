'use strict';
/**
 * server/src/config/firebase.js
 * ─────────────────────────────────────────────────────────────────
 * Thin re-export of the canonical Firebase module. This used to be
 * an independent admin.initializeApp() call with no double-init
 * guard — if src/core/database.js (or anything else requiring
 * src/core/firebase.js) initialized Firebase first, this file's
 * own initializeApp() call threw "the default Firebase app already
 * exists" and re-threw, crashing the process. All init logic now
 * lives in src/core/firebase.js; this file exists only so existing
 * `require('../config/firebase')` call sites in server/ don't need
 * to change.
 * ─────────────────────────────────────────────────────────────────
 */
module.exports = require('../../../src/core/firebase');
