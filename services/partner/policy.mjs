export class PartnerPolicy {
  constructor({ releaseThreshold = 0.9 } = {}) {
    this.releaseThreshold = releaseThreshold;
  }

  evaluateVerification({ passed, confidence = 0, issues = [] }) {
    if (passed && confidence >= this.releaseThreshold && issues.length === 0) {
      return { decision: 'approve', reason: 'verification_passed' };
    }

    if (confidence > 0 && confidence < this.releaseThreshold) {
      return { decision: 'human_review', reason: 'confidence_below_threshold' };
    }

    return { decision: 'human_review', reason: issues.length ? 'verification_issues' : 'verification_not_passed' };
  }

  canRelease({ actor, job, verification }) {
    if (actor?.type === 'ai') return false;
    if (!['verifying', 'human_review'].includes(job?.status)) return false;
    return verification?.decision === 'approve';
  }
}
