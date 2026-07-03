'use strict';
/**
 * config/firebase.js
 * ─────────────────────────────────────────────────────────────────
 * Thin re-export of the canonical Firebase module (src/core/
 * firebase.js), kept as a lazy-getter proxy for back-compat with
 * any code written against this file's old { db, auth, admin, init }
 * shape. No first-party code currently requires this path, but it's
 * kept rather than deleted in case external tooling references it.
 * ─────────────────────────────────────────────────────────────────
 */
const canonical = require('../src/core/firebase');

module.exports = {
  get db() {
    return canonical.getDb();
  },
  get auth() {
    return canonical.getAuth();
  },
  get admin() {
    return canonical.admin;
  },
  init: canonical.init,
};
