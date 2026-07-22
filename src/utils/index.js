'use strict';
// src/utils/index.js — barrel export for the utils directory
import crypto from 'crypto';
import * as helpers from './helpers.js';
import * as formatters from './formatters.js';
import validator from './validator.js';

// uid: short unique id (used by approval.js, agent.js, etc.)
function uid(length = 12) {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

export { uid };
export default {
  uid,
  ...helpers,
  ...formatters,
  ...validator,
};
