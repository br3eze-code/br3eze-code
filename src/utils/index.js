import crypto from 'crypto';
import * as helpers from './helpers.js';
import * as formatters from './formatters.js';
import * as validator from './validator.js';

// src/utils/index.js — barrel export for the utils directory

// uid: short unique id (used by approval.js, agent.js, etc.)
function uid(length = 12) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export { uid };
export * from './helpers.js';
export * from './formatters.js';
export * from './validator.js';

export default {
  uid,
  ...helpers,
  ...formatters,
  ...validator,
};