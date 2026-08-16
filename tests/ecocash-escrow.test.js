import { jest } from '@jest/globals';
import EcoCashEscrow from '../src/services/partner/ecocash-escrow.mjs';

function makeDb({ escrow = null, escrowStatus = null } = {}) {
  const writes = [];
  let record = escrow ? { id: 'esc-1', ...escrow, ...(escrowStatus ? { status: escrowStatus } : {}) } : null;
  const escrowDoc = {
    id: 'esc-1',
    async get() { return record ? { exists: true, id: 'esc-1', data: () => record } : { exists: false }; },
    async set(data) { writes.push(['set', data]); record = { id: 'esc-1', ...data }; },
    async update(data) { writes.push(['update', data]); if (record) Object.assign(record, data); },
  };
  return {
    writes,
    async updateWallet(...args) { writes.push(['wallet', args]); },
    collection(name) {
      if (name === 'tenants') return { doc: () => ({ get: async () => ({ exists: true, data: () => ({ commission: { install: 0.7 }, currency: 'USD' }) }) }) };
      if (name === 'escrow') return { doc: () => escrowDoc };
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

describe('EcoCashEscrow', () => {
  test('creates a commission-split job and initiates payment once', async () => {
    const db = makeDb();
    const ecocash = { initiatePayment: jest.fn().mockResolvedValue({ transactionId: 'tx-1' }) };
    const service = new EcoCashEscrow({ db, ecocash, now: () => new Date('2026-08-16T00:00:00Z') });
    const job = await service.createJob('partner-1', '+263771234567', [{ name: 'WiFi', price: 10 }]);
    expect(job.partnerShare).toBe(7);
    expect(job.platformShare).toBe(3);
    expect(db.writes[0][1].status).toBe('awaiting_payment');
    const payment = await service.collectPayment(job.escrowId);
    expect(payment.transactionId).toBe('tx-1');
    expect(ecocash.initiatePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 10, reference: job.escrowId }));
  });

  test('verifies successful payment and credits partner wallet', async () => {
    const db = makeDb({ escrow: { partnerId: 'partner-1', partnerShare: 7, amount: 10, currency: 'USD', transactionId: 'tx-1', status: 'payment_pending', services: [] } });
    const ecocash = { checkStatus: jest.fn().mockResolvedValue({ status: 'SUCCESSFUL', reference: 'ec-1' }) };
    const service = new EcoCashEscrow({ db, ecocash });
    const result = await service.verifyAndRelease('esc-1');
    expect(result.status).toBe('released');
    expect(db.writes.some(([type]) => type === 'wallet')).toBe(true);
    expect(db.writes.at(-1)[1].status).toBe('released');
  });

  test('does not repeat settlement for an already released escrow', async () => {
    const db = makeDb({ escrow: { partnerId: 'partner-1', partnerShare: 7, status: 'released' } });
    const ecocash = { checkStatus: jest.fn() };
    const service = new EcoCashEscrow({ db, ecocash });
    const result = await service.verifyAndRelease('esc-1');
    expect(result.alreadyProcessed).toBe(true);
    expect(ecocash.checkStatus).not.toHaveBeenCalled();
  });
});
