/** Compare internal and external payment records without provider knowledge. */
export function reconcilePayment(internal = {}, external = {}) {
  const amountMatch = Number(internal.amount) === Number(external.amount);
  const currencyMatch = String(internal.currency || '').toUpperCase() === String(external.currency || '').toUpperCase();
  const referenceMatch = Boolean(internal.reference && external.reference && String(internal.reference) === String(external.reference));
  const normalizeStatus = (value) => {
    const status = String(value || '').trim().toLowerCase();
    if (['succeeded', 'success', 'completed', 'complete', 'paid', 'settled'].includes(status)) return 'succeeded';
    if (['failed', 'failure', 'declined', 'rejected'].includes(status)) return 'failed';
    if (['pending', 'processing', 'in_progress', 'in-progress'].includes(status)) return 'pending';
    return status;
  };
  const statusMatch = internal.status ? normalizeStatus(internal.status) === normalizeStatus(external.status) : false;

  return Object.freeze({
    matched: amountMatch && currencyMatch && referenceMatch,
    amountMatch,
    currencyMatch,
    referenceMatch,
    statusMatch,
    transactionId: internal.transactionId || external.transactionId || null,
    provider: external.provider || internal.provider || null,
    discrepancies: [
      !amountMatch && 'amount',
      !currencyMatch && 'currency',
      !referenceMatch && 'reference',
      internal.status && !statusMatch && 'status',
    ].filter(Boolean),
  });
}
