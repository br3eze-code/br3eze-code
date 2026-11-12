import { createHash } from 'node:crypto';

export const CONTRACT_STATUSES = Object.freeze([
  'draft',
  'in_review',
  'approved',
  'sent',
  'signed',
  'rejected',
  'expired',
  'terminated',
]);

const TRANSITIONS = Object.freeze({
  draft: new Set(['in_review']),
  in_review: new Set(['draft', 'approved', 'rejected']),
  approved: new Set(['draft', 'sent']),
  sent: new Set(['signed', 'rejected', 'expired']),
  signed: new Set(['terminated']),
  rejected: new Set(['draft']),
  expired: new Set(),
  terminated: new Set(),
});

const SERVICE_MODELS = new Set(['baas', 'saas', 'local']);
const CURRENCIES = new Set(['USD', 'ZWL', 'ZiG', 'AED']);

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

export function hashContractDocument(document) {
  if (typeof document !== 'string' || !document.length) {
    throw new TypeError('document must be a non-empty string');
  }
  return createHash('sha256').update(document, 'utf8').digest('hex');
}

export function createContractDraft(input, { now = () => new Date() } = {}) {
  if (!input || typeof input !== 'object') throw new TypeError('contract input is required');
  const tenantId = requiredString(input.tenantId, 'tenantId');
  const createdBy = requiredString(input.createdBy, 'createdBy');
  const title = requiredString(input.title, 'title');
  const document = requiredString(input.document, 'document');
  const serviceModels = [...new Set(input.serviceModels || [])];

  if (!serviceModels.length || serviceModels.some((model) => !SERVICE_MODELS.has(model))) {
    throw new TypeError('serviceModels must contain one or more of baas, saas, local');
  }
  if (!Array.isArray(input.parties) || input.parties.length < 2) {
    throw new TypeError('at least two contract parties are required');
  }
  for (const party of input.parties) {
    requiredString(party?.legalName, 'party.legalName');
    requiredString(party?.role, 'party.role');
  }

  const currency = input.currency || 'USD';
  if (!CURRENCIES.has(currency)) throw new TypeError('unsupported currency code');

  const timestamp = now().toISOString();
  const version = Object.freeze({
    version: 1,
    document,
    documentHash: hashContractDocument(document),
    createdAt: timestamp,
    createdBy,
  });

  return Object.freeze({
    id: requiredString(input.id, 'id'),
    tenantId,
    title,
    serviceModels: Object.freeze(serviceModels),
    parties: Object.freeze(input.parties.map((party) => Object.freeze({
      legalName: party.legalName.trim(),
      role: party.role.trim(),
      entityRegistration: party.entityRegistration || null,
      jurisdiction: party.jurisdiction || null,
    }))),
    currency,
    status: 'draft',
    version: 1,
    versions: Object.freeze([version]),
    createdAt: timestamp,
    createdBy,
    updatedAt: timestamp,
    signatureEvidence: null,
  });
}

export function transitionContract(contract, nextStatus, {
  actorId,
  tenantId,
  expectedVersion,
  now = () => new Date(),
} = {}) {
  if (!contract || typeof contract !== 'object') throw new TypeError('contract is required');
  requiredString(actorId, 'actorId');
  requiredString(tenantId, 'tenantId');
  if (contract.tenantId !== tenantId) throw new Error('tenant scope mismatch');
  if (expectedVersion !== contract.version) throw new Error('contract version conflict');
  if (!CONTRACT_STATUSES.includes(nextStatus)) throw new TypeError('unknown contract status');
  if (nextStatus === 'signed') {
    throw new Error('signature evidence is required; use recordContractSignature');
  }
  if (!TRANSITIONS[contract.status]?.has(nextStatus)) {
    throw new Error(`invalid contract transition: ${contract.status} -> ${nextStatus}`);
  }
  if (nextStatus === 'approved' && contract.parties.some((party) => !party.legalName || !party.role)) {
    throw new Error('all parties must be identified before approval');
  }
  if (nextStatus === 'sent' && contract.versions[contract.versions.length - 1]?.documentHash !== hashContractDocument(contract.versions[contract.versions.length - 1]?.document)) {
    throw new Error('document integrity check failed');
  }

  const recordedAt = now().toISOString();
  return Object.freeze({
    ...contract,
    status: nextStatus,
    updatedAt: recordedAt,
    updatedBy: actorId,
  });
}

export function recordContractSignature(contract, evidence, {
  tenantId,
  actorId,
  expectedVersion,
  now = () => new Date(),
} = {}) {
  if (!contract || typeof contract !== 'object') throw new TypeError('contract is required');
  if (contract.tenantId !== tenantId) throw new Error('tenant scope mismatch');
  requiredString(actorId, 'actorId');
  if (expectedVersion !== contract.version) throw new Error('contract version conflict');
  if (contract.status !== 'sent') throw new Error('only sent contracts can be signed');
  if (!evidence || typeof evidence !== 'object') throw new TypeError('signature evidence is required');

  const required = ['provider', 'providerEventId', 'signerIdentity', 'signedAt', 'documentHash'];
  for (const field of required) requiredString(evidence[field], `evidence.${field}`);

  const currentVersion = contract.versions[contract.versions.length - 1];
  if (evidence.documentHash !== currentVersion.documentHash) {
    throw new Error('signature document hash does not match the sent version');
  }
  if (Number.isNaN(Date.parse(evidence.signedAt))) throw new TypeError('evidence.signedAt must be a valid timestamp');

  const recordedAt = now().toISOString();
  const signatureEvidence = Object.freeze({
    provider: evidence.provider,
    providerEventId: evidence.providerEventId,
    signerIdentity: evidence.signerIdentity,
    signedAt: new Date(evidence.signedAt).toISOString(),
    documentHash: evidence.documentHash,
    recordedAt,
    recordedBy: actorId,
  });

  return Object.freeze({
    ...contract,
    status: 'signed',
    signatureEvidence,
    updatedAt: now().toISOString(),
    updatedBy: actorId,
  });
}
