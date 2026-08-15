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
    if (!partnerId || !customerId || !Array.isArray(services) || services.length === 0) throw new TypeError('partnerId, customerId and services are required');
    const amountMinor = sumMoney(services, currency);
    const id = randomUUID();
    const now = new Date().toISOString();
    const job = { id, partnerId, customerId, services, amountMinor, currency, status: 'created', history: [], createdAt: now, updatedAt: now };
    await this.db.collection('jobs').doc(id).set(job);
    return job;
  }

  async fundJob(jobId, payment) {
    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);
    const job = snapshot.data();
    if (payment.status !== 'settled') throw new Error('Job can only be funded by a settled payment');
    if (payment.amountMinor !== job.amountMinor || payment.currency !== job.currency) throw new Error('Payment does not match job amount or currency');
    const funded = transitionJob(job, 'funded', { paymentId: payment.id });
    await ref.set(funded);
    return funded;
  }

  async startWork(jobId, actor = { type: 'partner' }) {
    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);
    const working = transitionJob(snapshot.data(), 'working', { actorType: actor.type });
    await ref.set(working);
    return working;
  }

  async beginVerification(jobId, evidence = []) {
    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);
    const verifying = transitionJob(snapshot.data(), 'verifying', { evidenceCount: evidence.length });
    await ref.set(verifying);
    return verifying;
  }

  async verifyJob(jobId, verification) {
    const ref = this.db.collection('jobs').doc(jobId);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new Error(`Job not found: ${jobId}`);
    const job = snapshot.data();
    if (job.status !== 'verifying') throw new Error(`Job must be verifying before verification: ${job.status}`);

    const decision = this.policy.evaluateVerification(verification);
    const now = new Date().toISOString();
    const verificationRecord = {
      ...verification,
      decision: decision.decision,
      decisionReason: decision.reason,
    };
    const updated = {
      ...job,
      status: 'human_review',
      verification: verificationRecord,
      updatedAt: now,
      history: [...(job.history ?? []), { from: job.status, to: 'human_review', at: now, verification: verificationRecord }],
    };
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
    if (!this.policy.canRelease({ actor, job, verification: job.verification })) throw new Error('Job is not authorized for release');

    const split = splitCommission(job.amountMinor, partnerRateBps);
    const released = transitionJob(job, 'released', { actorType: actor.type });
    const settlement = {
      grossMinor: job.amountMinor,
      partnerMinor: split.partnerMinor,
      platformMinor: split.platformMinor,
      currency: job.currency,
      idempotencyKey,
      settledAt: new Date().toISOString(),
    };

    await ref.set({ ...released, settlement });
    await this.ledger.credit({ accountId: `partner:${job.partnerId}`, amountMinor: split.partnerMinor, currency: job.currency, referenceId: jobId, metadata: { type: 'job_settlement', idempotencyKey } });
    await this.ledger.credit({ accountId: 'platform:revenue', amountMinor: split.platformMinor, currency: job.currency, referenceId: jobId, metadata: { type: 'platform_commission', idempotencyKey } });

    const result = { jobId, ...split, currency: job.currency };
    if (this.idempotency?.set) await this.idempotency.set(idempotencyKey, result);
    return result;
  }
}
