import { createHash } from 'node:crypto';

const REQUIRED_STORE_METHODS = ['getHead', 'appendEvidence'];

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  if (value === undefined) return null;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  throw new TypeError('Evidence payload must contain only JSON-compatible values');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} is required`);
  }
  return value.trim();
}

/**
 * Contract evidence writer.
 *
 * The storage adapter must implement atomic append with compare-and-swap on
 * expectedPreviousHash and enforce uniqueness of (tenantId, idempotencyKey).
 * A hash chain is tamper-evident only when the durable store and its access
 * controls prevent silent rewriting; it is not a digital signature.
 */
export class ContractEvidenceService {
  constructor({ store, clock = () => new Date().toISOString() } = {}) {
    if (!store || REQUIRED_STORE_METHODS.some((method) => typeof store[method] !== 'function')) {
      throw new TypeError('store must implement getHead() and appendEvidence()');
    }
    this.store = store;
    this.clock = clock;
  }

  async append(input) {
    const tenantId = requiredString(input?.tenantId, 'tenantId');
    const contractId = requiredString(input?.contractId, 'contractId');
    const eventType = requiredString(input?.eventType, 'eventType');
    const actorId = requiredString(input?.actorId, 'actorId');
    const idempotencyKey = requiredString(input?.idempotencyKey, 'idempotencyKey');
    const payload = canonicalize(input?.payload ?? {});

    if (eventType.startsWith('signature.') && !/^[a-f0-9]{64}$/i.test(String(payload.documentSha256 || ''))) {
      throw new TypeError('Signature events require payload.documentSha256 as a SHA-256 hex digest');
    }

    const head = await this.store.getHead({ tenantId, contractId });
    const previousHash = head?.eventHash ?? null;
    const unsigned = {
      schemaVersion: 1,
      tenantId,
      contractId,
      eventType,
      actorId,
      idempotencyKey,
      occurredAt: requiredString(this.clock(), 'clock result'),
      previousHash,
      payload,
    };
    const eventHash = sha256(JSON.stringify(canonicalize(unsigned)));
    const record = Object.freeze({ ...unsigned, eventHash });

    // The adapter must atomically verify expectedPreviousHash, append once, and
    // enforce idempotency. Fail closed: do not report success on persistence error.
    const result = await this.store.appendEvidence(record, {
      expectedPreviousHash: previousHash,
      idempotencyKey,
    });
    if (!result || result.persisted !== true) {
      throw new Error('Contract evidence was not durably persisted');
    }
    return record;
  }

  static verifyChain(records) {
    let previousHash = null;
    for (const record of records) {
      const { eventHash, ...unsigned } = record;
      if (unsigned.previousHash !== previousHash) return false;
      const expected = sha256(JSON.stringify(canonicalize(unsigned)));
      if (eventHash !== expected) return false;
      previousHash = eventHash;
    }
    return true;
  }
}
