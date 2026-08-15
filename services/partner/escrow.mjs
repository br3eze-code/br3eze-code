import { randomUUID } from 'node:crypto';

/**
 * Compatibility facade for the original EscrowService idea.
 * Financial custody belongs to PaymentService/provider adapters; this service
 * owns job state, evidence and verification policy instead of pretending that
 * Firestore itself is an escrow account.
 */
export class EscrowService {
  constructor({ jobs, payments, aiVerifier, db, notifier }) {
    this.jobs = jobs;
    this.payments = payments;
    this.aiVerifier = aiVerifier;
    this.db = db;
    this.notifier = notifier;
  }

  async createJob({ partnerId, customerId, services, currency, paymentProvider }) {
    const job = await this.jobs.createJob({ partnerId, customerId, services, currency });
    const payment = await this.payments.createPayment({
      provider: paymentProvider,
      paymentId: `job-payment:${job.id}`,
      amountMinor: job.amountMinor,
      currency: job.currency,
      customer: { id: customerId },
      metadata: { jobId: job.id, partnerId },
    });

    if (payment.status === 'settled') await this.jobs.fundJob(job.id, payment);
    if (this.notifier) await this.notifier.partnerJobFunded({ partnerId, jobId: job.id, amountMinor: job.amountMinor, currency });

    return { jobId: job.id, paymentId: payment.id, status: payment.status };
  }

  async recordEvidence(jobId, { submittedBy, files = [], metadata = {} }) {
    if (!this.db) throw new Error('EscrowService requires db for evidence storage');
    const evidenceId = randomUUID();
    const evidence = {
      id: evidenceId,
      jobId,
      submittedBy,
      files,
      metadata,
      status: 'submitted',
      createdAt: new Date().toISOString(),
    };
    await this.db.collection('job_evidence').doc(evidenceId).set(evidence);
    return evidence;
  }

  async verifyCompletion(jobId, evidence) {
    await this.jobs.beginVerification(jobId, evidence);
    const verification = await this.aiVerifier.verify({ jobId, evidence });

    // AI can recommend a decision, but cannot release funds.
    const result = await this.jobs.verifyJob(jobId, {
      passed: Boolean(verification.passed),
      confidence: Number(verification.confidence ?? 0),
      issues: Array.isArray(verification.issues) ? verification.issues : [],
      evidenceId: verification.evidenceId ?? null,
      model: verification.model ?? null,
    });

    return result;
  }

  async releaseAfterHumanApproval(jobId, { reviewerId, partnerRateBps, idempotencyKey }) {
    if (!reviewerId) throw new TypeError('reviewerId is required');
    return this.jobs.releaseJob(jobId, {
      actor: { type: 'human', id: reviewerId },
      partnerRateBps,
      idempotencyKey,
    });
  }
}
