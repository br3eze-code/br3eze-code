import { getSupabaseAdmin } from '../adapters/auth/supabase.js';

/**
 * Provider-neutral persistence boundary for the payment domain.
 * The payment domain knows only this contract; Supabase/Postgres is an adapter.
 */
export function createSupabasePaymentPersistence({ client = getSupabaseAdmin() } = {}) {
  if (!client) return null;

  async function insertEvent(event) {
    const { data, error } = await client.from('payment_events').insert({
      event_id: event.eventId,
      event_type: event.type,
      provider: event.provider,
      transaction_id: event.transactionId,
      reference: event.reference,
      idempotency_key: event.idempotencyKey,
      amount: event.amount,
      currency: event.currency,
      order_id: event.orderId,
      invoice_id: event.invoiceId,
      tenant_id: event.tenantId,
      occurred_at: event.occurredAt,
      metadata: event.metadata,
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function upsertTransaction(transaction) {
    const { data, error } = await client.from('payment_transactions').upsert({
      transaction_id: transaction.transactionId,
      provider: transaction.provider,
      reference: transaction.reference,
      order_id: transaction.orderId || null,
      invoice_id: transaction.invoiceId || null,
      tenant_id: transaction.tenantId || null,
      amount: transaction.amount,
      currency: String(transaction.currency).toUpperCase(),
      status: transaction.status || 'pending',
      payment_method: transaction.paymentMethod || null,
      idempotency_key: transaction.idempotencyKey || null,
      provider_transaction_id: transaction.providerTransactionId || null,
      metadata: transaction.metadata || {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'transaction_id' }).select().single();
    if (error) throw error;
    return data;
  }

  async function appendLedgerEntry(entry) {
    const { data, error } = await client.from('payment_ledger_entries').insert({
      entry_id: entry.ledgerEntryId || entry.entryId,
      transaction_id: entry.transactionId,
      entry_type: entry.entryType || 'payment',
      direction: entry.direction,
      amount: entry.amount,
      currency: String(entry.currency).toUpperCase(),
      account: entry.account || entry.accountId || 'default',
      reference: entry.reference || entry.transactionId,
      metadata: entry.metadata || {},
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function upsertSettlement(settlement) {
    const { data, error } = await client.from('payment_settlements').upsert({
      settlement_id: settlement.settlementId,
      provider: settlement.provider,
      transaction_id: settlement.transactionId || null,
      provider_reference: settlement.providerReference || settlement.externalReference || null,
      amount: settlement.amount,
      currency: String(settlement.currency).toUpperCase(),
      status: settlement.status || 'pending',
      settled_at: settlement.settledAt || null,
      metadata: settlement.metadata || {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'settlement_id' }).select().single();
    if (error) throw error;
    return data;
  }

  async function recordReconciliation(result) {
    const { data, error } = await client.from('payment_reconciliation').insert({
      reconciliation_id: result.reconciliationId,
      transaction_id: result.transactionId || null,
      settlement_id: result.settlementId || null,
      expected_amount: result.expectedAmount,
      actual_amount: result.actualAmount ?? null,
      currency: String(result.currency).toUpperCase(),
      status: result.status || (result.matched ? 'matched' : 'unmatched'),
      discrepancy: result.discrepancy ?? null,
      reason: result.reason || null,
      metadata: result.metadata || {},
    }).select().single();
    if (error) throw error;
    return data;
  }

  async function claimIdempotency(key, operation, requestHash = null) {
    const { data, error } = await client.from('payment_idempotency').insert({
      idempotency_key: key,
      operation,
      request_hash: requestHash,
      status: 'processing',
    }).select().single();
    if (!error) return { claimed: true, record: data };
    if (error.code !== '23505') throw error;
    const existing = await client.from('payment_idempotency').select('*').eq('idempotency_key', key).maybeSingle();
    if (existing.error) throw existing.error;
    return { claimed: false, record: existing.data };
  }

  async function completeIdempotency(key, response, status = 'completed') {
    const { data, error } = await client.from('payment_idempotency').update({ status, response, completed_at: new Date().toISOString() }).eq('idempotency_key', key).select().single();
    if (error) throw error;
    return data;
  }

  async function releaseIdempotency(key) {
    const { error } = await client.from('payment_idempotency').delete().eq('idempotency_key', key).eq('status', 'processing');
    if (error) throw error;
    return true;
  }

  return Object.freeze({ insertEvent, upsertTransaction, appendLedgerEntry, upsertSettlement, recordReconciliation, claimIdempotency, completeIdempotency, releaseIdempotency });
}

export default createSupabasePaymentPersistence;
