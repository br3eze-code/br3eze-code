import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createEcoCashWebhookRouter, processEcoCashEvent } from '../src/gateway/ecocash-webhook.mjs';

function makeDb({ processed = false, empty = false } = {}) {
  const marker = { get: async () => ({ exists: processed }), set: async () => {} };
  const escrow = { id: 'esc-1', data: () => ({ partnerId: 'partner-1', partnerShare: 12, currency: 'USD' }) };
  return {
    collection(name) {
      if (name === 'processed_webhooks') return { doc: () => marker };
      if (name === 'escrow') return { where: () => ({ limit: () => ({ get: async () => ({ empty, docs: empty ? [] : [escrow] }) }) }) };
      if (name === 'webhook_errors') return { add: async () => {} };
      throw new Error(`unexpected collection ${name}`);
    },
  };
}

describe('EcoCash webhook', () => {
  test('rejects invalid signatures without processing', async () => {
    const release = jest.fn();
    const app = express();
    app.use(express.json());
    app.use(createEcoCashWebhookRouter({ db: makeDb(), verifySignature: async () => false, releaseEscrow: release }));
    const response = await request(app).post('/webhooks/ecocash').send({ status: 'SUCCESS', transactionId: 'tx-1' });
    expect(response.status).toBe(401);
    expect(release).not.toHaveBeenCalled();
  });

  test('releases a successful transaction once and notifies the partner', async () => {
    const release = jest.fn().mockResolvedValue({ ok: true });
    const notify = jest.fn().mockResolvedValue(undefined);
    const result = await processEcoCashEvent({ db: makeDb(), verifySignature: undefined, releaseEscrow: release, notifyPartner: notify, payload: { status: 'SUCCESSFUL', transactionId: 'tx-2' } });
    expect(result.status).toBe('released');
    expect(release).toHaveBeenCalledWith('esc-1', expect.objectContaining({ transactionId: 'tx-2' }));
    expect(notify).toHaveBeenCalledWith('partner-1', expect.objectContaining({ currency: 'USD' }));
  });

  test('does not release an already processed transaction', async () => {
    const release = jest.fn();
    const result = await processEcoCashEvent({ db: makeDb({ processed: true }), releaseEscrow: release, payload: { status: 'SUCCESS', transactionRef: 'tx-3' } });
    expect(result.status).toBe('already_processed');
    expect(release).not.toHaveBeenCalled();
  });
});
