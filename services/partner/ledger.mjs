import { assertMoney } from './money.mjs';

export class LedgerService {
  constructor({ db, collection = 'ledger_entries' }) {
    if (!db?.collection) throw new TypeError('LedgerService requires a Firestore-compatible db');
    this.db = db;
    this.collection = collection;
  }

  async append({ accountId, type, amountMinor, currency, referenceId, metadata = {} }) {
    assertMoney({ amountMinor, currency });
    if (!accountId || !type || !referenceId) {
      throw new TypeError('accountId, type and referenceId are required');
    }

    const entry = {
      accountId,
      type,
      amountMinor,
      currency,
      referenceId,
      metadata,
      createdAt: new Date().toISOString(),
    };

    const ref = this.db.collection(this.collection).doc();
    await ref.set({ id: ref.id, ...entry });
    return { id: ref.id, ...entry };
  }

  async credit({ accountId, amountMinor, currency, referenceId, metadata }) {
    return this.append({
      accountId,
      type: 'credit',
      amountMinor,
      currency,
      referenceId,
      metadata,
    });
  }

  async debit({ accountId, amountMinor, currency, referenceId, metadata }) {
    return this.append({
      accountId,
      type: 'debit',
      amountMinor,
      currency,
      referenceId,
      metadata,
    });
  }
}
