import { ContractEvidenceService } from '../../src/contracts/contract-evidence-service.js';

function createStore() {
  const records = [];
  return {
    records,
    async getHead({ tenantId, contractId }) {
      const scoped = records.filter((item) => item.tenantId === tenantId && item.contractId === contractId);
      return scoped.at(-1) || null;
    },
    async appendEvidence(record, { expectedPreviousHash, idempotencyKey }) {
      const duplicate = records.some((item) => item.tenantId === record.tenantId && item.idempotencyKey === idempotencyKey);
      if (duplicate) return { persisted: false, duplicate: true };
      const current = await this.getHead({ tenantId: record.tenantId, contractId: record.contractId });
      if ((current?.eventHash ?? null) !== expectedPreviousHash) throw new Error('Evidence chain head changed');
      records.push(record);
      return { persisted: true };
    },
  };
}

const base = {
  tenantId: 'tenant-1',
  contractId: 'contract-1',
  eventType: 'contract.created',
  actorId: 'user-1',
  idempotencyKey: 'request-1',
  payload: { template: 'software-services', version: 1 },
};

describe('ContractEvidenceService', () => {
  it('persists chained events and verifies the chain', async () => {
    const store = createStore();
    const service = new ContractEvidenceService({ store, clock: () => '2026-11-10T10:00:00.000Z' });
    const first = await service.append(base);
    const second = await service.append({ ...base, eventType: 'contract.approved', idempotencyKey: 'request-2' });
    expect(second.previousHash).toBe(first.eventHash);
    expect(ContractEvidenceService.verifyChain(store.records)).toBe(true);
  });

  it('rejects signature events without a document digest', async () => {
    const service = new ContractEvidenceService({ store: createStore() });
    await expect(service.append({ ...base, eventType: 'signature.completed' }))
      .rejects.toThrow(/documentSha256/);
  });

  it('fails closed when persistence does not confirm durable append', async () => {
    const store = createStore();
    store.appendEvidence = async () => ({ persisted: false });
    const service = new ContractEvidenceService({ store });
    await expect(service.append(base)).rejects.toThrow(/not durably persisted/);
  });

  it('detects tampering and rejects missing tenant scope', async () => {
    const store = createStore();
    const service = new ContractEvidenceService({ store });
    const event = await service.append(base);
    expect(ContractEvidenceService.verifyChain([{ ...event, actorId: 'forged' }])).toBe(false);
    await expect(service.append({ ...base, tenantId: '' })).rejects.toThrow(/tenantId is required/);
  });
});
