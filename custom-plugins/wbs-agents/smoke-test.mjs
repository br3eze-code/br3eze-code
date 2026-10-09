import assert from 'node:assert/strict';
import {
  WBS,
  validateRequest,
  capabilityResult,
  denyUnlessAuthorized,
  safeExecute,
  createWbsManifest,
} from './index.mjs';

assert.equal(WBS.length, 10);
assert.equal(validateRequest({ action: 'connect' }).ok, true);
assert.equal(validateRequest({}).code, 'INVALID_ACTION');
assert.equal(capabilityResult('scan', false).code, 'UNSUPPORTED');
assert.equal(denyUnlessAuthorized({}).code, 'AUTHORIZATION_REQUIRED');
assert.equal(denyUnlessAuthorized({ authorized: true, actorId: 'test' }).ok, true);
assert.equal(safeExecute({ action: 'x' }, () => ({ ok: true })).ok, true);
assert.equal(safeExecute({ action: 'x' }, () => { throw new Error('boom'); }).code, 'EXECUTION_FAILED');
assert.equal(createWbsManifest('example', '1.0.0').schema, 'agentos.wbs.v1');

console.log('WBS safety smoke tests: PASS');
