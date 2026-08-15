import { randomUUID } from 'node:crypto';
import { splitCommission, sumMoney } from './money.mjs';
import { transitionJob } from './state-machine.mjs';

export class PartnerJobService {
  constructor({ db, ledger, policy, idempotency }) {
    this.db = db;
    this.ledger = ledger;
    this.policy = policy;
    this.idempotency = idempotency;
  }

  async createJob({ partnerId, customerId, services, currency }) {
    if (!partnerId || !customerId || !Array.isArray(services) || services.length === 0) {
      throw new TypeError('partnerId, customerId and services are required');
    }

    const amountMinor = sumMoney(services, currency);
    const id = randomUUID();
    const now = new Date().toISOString();

    const job = {
      id,
      partnerId,
      customerId,
      services,
      amountMinor,
      currency,
      status: 'created',
      history: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.db.collection('jobs').doc(id).set(job);
    return job;
  }

  async fundJob(jobId, payment) {
    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);

    const job = snapshot.data();
    if (payment.status !== 'settled') throw new Error('Job can only be funded by a settled payment');
    if (payment.amountMinor !== job.amountMinor || payment.currency !== job.currency) {
      throw new Error('Payment does not match job amount or currency');
    }

    const funded = transitionJob(job, 'funded', { paymentId: payment.id });
    await ref.set(funded);
    return funded;
  }

  async verifyJob(jobId, verification) {
    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);

    const job = snapshot.data();
    const decision = this.policy.evaluateVerification(verification);
    const next = decision.decision === 'approve' ? 'verifying' : 'human_review';
    const updated = transitionJob(job, next, { verification: { ...verification, decision } });
    await ref.set(updated);
    return { job: updated, decision };
  }

  async releaseJob(jobId, { actor, partnerRateBps, idempotencyKey }) {
    if (!idempotencyKey) throw new TypeError('idempotencyKey is required');

    if (this.idempotency?.has) {
      const existing = await this.idempotency.has(idempotencyKey);
      if (existing) return existing;
    }

    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);

    const job = snapshot.data();
    const verification = job.history?.at(-1)?.verification;
    if (!this.policy.canRelease({ actor, job, verification })) {
      throw new Error('Job is not authorized for release');
    }

    const split = splitCommission(job.amountMinor, partnerRateBps);
    const released = transitionJob(job, 'released', { actorType: actor.type });

    await ref.set({
      ...released,
      settlement: {
        grossMinor: job.amountMinor,
        partnerMinor: split.partnerMinor,
        platformMinor: split.platformMinor,
        currency: job.currency,
        idempotencyKey,
        settledAt: new Date().toISOString(),
      },
    });

    await this.ledger.credit({
      accountId: `partner:${job.partnerId}`,
      amountMinor: split.partnerMinor,
      currency: job.currency,
      referenceId: jobId,
      metadata: { type: 'job_settlement', idempotencyKey },
    });

    const result = { jobId, ...split, currency: job.currency };
    if (this.idempotency?.set) await this.idempotency.set(idempotencyKey, result);
    return result;
  }
}
