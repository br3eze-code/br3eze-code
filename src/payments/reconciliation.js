/** Compare internal and external payment records without provider knowledge. */
export function reconcilePayment(internal = {}, external = {}) {
  const amountMatch = Number(internal.amount) === Number(external.amount);
  const currencyMatch = String(internal.currency || '').toUpperCase() === String(external.currency || '').toUpperCase();
  const referenceMatch = Boolean(internal.reference && external.reference && String(internal.reference) === String(external.reference));
  const statusMatch = internal.status ? String(internal.status).toLowerCase() === String(external.status || '').toLowerCase() : false;

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
