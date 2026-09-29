import crypto from 'node:crypto';

export const VerificationStatus = Object.freeze({
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
});

export class VerificationEngine {
  constructor({ checks = {} } = {}) {
    this.checks = new Map(Object.entries(checks));
  }

  register(name, check) {
    if (!name || typeof check !== 'function') throw new TypeError('Verification check requires a name and function');
    this.checks.set(name, check);
    return this;
  }

  async verify(target, requirements = []) {
    const names = [...new Set(requirements)];
    const results = [];
    for (const name of names) {
      const check = this.checks.get(name);
      if (!check) {
        results.push({ id: crypto.randomUUID(), name, status: VerificationStatus.FAILED, error: `Unknown verification check: ${name}` });
        continue;
      }
      try {
        const value = await check(target);
        const passed = value === true || value?.passed === true;
        results.push({
          id: crypto.randomUUID(),
          name,
          status: passed ? VerificationStatus.PASSED : VerificationStatus.FAILED,
          evidence: value === true ? null : value,
        });
      } catch (error) {
        results.push({ id: crypto.randomUUID(), name, status: VerificationStatus.FAILED, error: error.message });
      }
    }
    return {
      status: results.every((result) => result.status === VerificationStatus.PASSED)
        ? VerificationStatus.PASSED
        : VerificationStatus.FAILED,
      passed: results.every((result) => result.status === VerificationStatus.PASSED),
      results,
      verifiedAt: new Date().toISOString(),
    };
  }
}
