const VALID = new Set(['pending', 'released', 'failed', 'reversed']);

export function createSettlement(input = {}) {
  const status = String(input.status || 'pending').toLowerCase();
  if (!VALID.has(status)) throw new TypeError(`Unsupported settlement status: ${status}`);
  if (!input.transactionId) throw new TypeError('Settlement transactionId is required');
  return Object.freeze({
    settlementId: String(input.settlementId || `${input.transactionId}:settlement`),
    transactionId: String(input.transactionId),
    provider: input.provider ? String(input.provider) : null,
    status,
    amount: input.amount ?? null,
    currency: String(input.currency || 'USD').toUpperCase(),
    settledAt: status === 'released' ? (input.settledAt || new Date().toISOString()) : null,
    externalReference: input.externalReference ? String(input.externalReference) : null,
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}
