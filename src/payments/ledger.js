import { randomUUID } from 'node:crypto';

const VALID = new Set(['debit', 'credit']);

export function createLedgerEntry(input = {}) {
  const direction = String(input.direction || '').toLowerCase();
  if (!VALID.has(direction)) throw new TypeError('Ledger direction must be debit or credit');
  if (!input.transactionId) throw new TypeError('Ledger transactionId is required');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError('Ledger amount must be positive');

  return Object.freeze({
    ledgerEntryId: String(input.ledgerEntryId || randomUUID()),
    transactionId: String(input.transactionId),
    accountId: input.accountId ? String(input.accountId) : null,
    direction,
    amount,
    currency: String(input.currency || 'USD').toUpperCase(),
    reference: input.reference ? String(input.reference) : null,
    eventId: input.eventId ? String(input.eventId) : null,
    occurredAt: input.occurredAt || new Date().toISOString(),
    metadata: Object.freeze({ ...(input.metadata || {}) }),
  });
}
