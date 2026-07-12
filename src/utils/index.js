'use strict';
// src/utils/index.js — barrel export for the utils directory
const crypto = require('crypto');

// uid: short unique id (used by approval.js, agent.js, etc.)
function uid(length = 12) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export { uid };
export default {
  uid,
  ...require('./helpers'),
  ...require('./formatters'),
  ...require('./validator'),
};
