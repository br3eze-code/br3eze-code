import express from 'express';
import crypto from 'node:crypto';

function constantTimeEqual(a, b) {
  if (!a || !b) return false;
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function redactPayload(payload = {}) {
  const copy = { ...payload };
  for (const key of ['pin', 'merchantPin', 'apiKey', 'secret', 'token', 'password']) {
    if (key in copy) copy[key] = '[REDACTED]';
  }
  return copy;
}

export function createEcoCashWebhookRouter({
  db,
  ecocash,
  releaseEscrow,
  notifyPartner,
  verifySignature,
  queue = null,
  logger = console,
  path = '/webhooks/ecocash',
} = {}) {
  if (!db) throw new TypeError('db is required');
  if (!ecocash && !verifySignature) throw new TypeError('ecocash or verifySignature is required');
  if (typeof releaseEscrow !== 'function') throw new TypeError('releaseEscrow is required');

  const router = express.Router();
  router.post(path, async (req, res) => {
    const payload = req.body || {};
    const headers = req.headers || {};
    const valid = await (verifySignature
      ? verifySignature(payload, headers)
      : ecocash.verifyWebhook(payload, headers));
    if (!valid) return res.status(401).json({ error: 'Invalid signature' });

    // Acknowledge only after authentication, then perform idempotent work asynchronously.
    res.status(202).json({ received: true });
    const work = () => processEcoCashEvent({ db, ecocash, releaseEscrow, notifyPartner, payload, logger });
    try {
      if (queue) await queue(work);
      else await work();
    } catch (error) {
      logger.error?.('[EcoCash Webhook] processing failed', { error: error.message });
      try {
        await db.collection('webhook_errors').add({
          provider: 'ecocash',
          payload: redactPayload(payload),
          error: error.message,
          createdAt: new Date().toISOString(),
        });
      } catch (logError) {
        logger.error?.('[EcoCash Webhook] reconciliation log failed', { error: logError.message });
      }
    }
    return undefined;
  });
  return router;
}

export async function processEcoCashEvent({ db, ecocash, releaseEscrow, notifyPartner, payload, logger = console }) {
  const status = String(payload.status || '').toUpperCase();
  const transactionId = payload.transactionId || payload.transactionRef;
  if (status !== 'SUCCESSFUL' && status !== 'SUCCESS') return { status: 'ignored', transactionId };
  if (!transactionId) throw new Error('EcoCash transaction ID is required');

  const marker = db.collection('processed_webhooks').doc(`ecocash:${transactionId}`);
  const existing = await marker.get();
  if (existing?.exists) return { status: 'already_processed', transactionId };

  const snapshot = await db.collection('escrow').where('transactionId', '==', transactionId).limit(1).get();
  if (snapshot.empty) {
    throw new Error(`No escrow found for transaction ${transactionId}`);
  }

  const escrowDoc = snapshot.docs[0];
  const escrow = escrowDoc.data();
  const released = await releaseEscrow(escrowDoc.id, { transactionId, payload });
  await marker.set({ provider: 'ecocash', transactionId, escrowId: escrowDoc.id, processedAt: new Date().toISOString() });

  if (notifyPartner && escrow.partnerId) {
    await notifyPartner(escrow.partnerId, {
      transactionId,
      partnerShare: escrow.partnerShare,
      currency: escrow.currency || payload.currency || 'USD',
    });
  }
  logger.info?.(`[EcoCash Webhook] escrow released for ${transactionId}`);
  return { status: 'released', transactionId, released };
}

export { constantTimeEqual, redactPayload };
export default createEcoCashWebhookRouter;
