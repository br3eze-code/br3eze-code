import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createContractDraft,
  hashContractDocument,
  recordContractSignature,
  transitionContract,
} from '../../src/domains/contracts/contract-lifecycle.js';

const fixedNow = () => new Date('2026-11-10T10:00:00.000Z');
const draftInput = {
  id: 'contract-001',
  tenantId: 'tenant-a',
  createdBy: 'user-a',
  title: 'AgentOS Engineering Services',
  document: 'Draft terms v1',
  serviceModels: ['saas', 'local'],
  currency: 'USD',
  parties: [
    { legalName: 'Br3eze Service Provider Ltd', role: 'service_provider', jurisdiction: 'Zimbabwe' },
    { legalName: 'Principal Entity (pending verification)', role: 'principal', jurisdiction: 'UAE' },
  ],
};

test('creates a draft with a stable document hash and explicit service models', () => {
  const contract = createContractDraft(draftInput, { now: fixedNow });
  assert.equal(contract.status, 'draft');
  assert.equal(contract.version, 1);
  assert.equal(contract.versions[0].documentHash, hashContractDocument('Draft terms v1'));
  assert.deepEqual(contract.serviceModels, ['saas', 'local']);
});

test('rejects missing tenant, parties, or service models', () => {
  assert.throws(() => createContractDraft({ ...draftInput, tenantId: '' }), /tenantId is required/);
  assert.throws(() => createContractDraft({ ...draftInput, parties: [] }), /at least two contract parties/);
  assert.throws(() => createContractDraft({ ...draftInput, serviceModels: ['unknown'] }), /serviceModels/);
});

test('enforces tenant scope, optimistic version and legal state transitions', () => {
  const contract = createContractDraft(draftInput, { now: fixedNow });
  assert.throws(() => transitionContract(contract, 'in_review', {
    actorId: 'user-a', tenantId: 'tenant-b', expectedVersion: 1, now: fixedNow,
  }), /tenant scope mismatch/);
  assert.throws(() => transitionContract(contract, 'signed', {
    actorId: 'user-a', tenantId: 'tenant-a', expectedVersion: 1, now: fixedNow,
  }), /signature evidence is required/);
  assert.throws(() => transitionContract(contract, 'in_review', {
    actorId: 'user-a', tenantId: 'tenant-a', expectedVersion: 2, now: fixedNow,
  }), /version conflict/);
});

test('signature evidence must bind to the exact sent document hash', () => {
  let contract = createContractDraft(draftInput, { now: fixedNow });
  for (const status of ['in_review', 'approved', 'sent']) {
    contract = transitionContract(contract, status, {
      actorId: 'user-a', tenantId: 'tenant-a', expectedVersion: 1, now: fixedNow,
    });
  }
  const evidence = {
    provider: 'example-signing-adapter',
    providerEventId: 'evt-1',
    signerIdentity: 'signer@example.test',
    signedAt: '2026-11-10T10:05:00.000Z',
    documentHash: hashContractDocument('Draft terms v1'),
  };
  assert.throws(() => recordContractSignature(contract, {
    ...evidence, documentHash: hashContractDocument('tampered document'),
  }, { tenantId: 'tenant-a', actorId: 'user-a', expectedVersion: 1, now: fixedNow }), /does not match/);

  const signed = recordContractSignature(contract, evidence, {
    tenantId: 'tenant-a', actorId: 'user-a', expectedVersion: 1, now: fixedNow,
  });
  assert.equal(signed.status, 'signed');
  assert.equal(signed.signatureEvidence.providerEventId, 'evt-1');
});

test('document hash changes when document content changes', () => {
  assert.notEqual(hashContractDocument('version A'), hashContractDocument('version B'));
});
