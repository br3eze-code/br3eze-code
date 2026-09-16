/**
 * Financial primitives for Partner Platform.
 *
 * All monetary values are integer minor units. Never use floating point
 * numbers for balances, prices, commissions, or settlement calculations.
 */

export function assertMoney({ amountMinor, currency }) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError('amountMinor must be a non-negative safe integer');
  }

  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new TypeError('currency must be an ISO-4217 style 3-letter code');
  }

  return { amountMinor, currency };
}

export function sumMoney(items, currency) {
  assertMoney({ amountMinor: 0, currency });

  return items.reduce((sum, item) => {
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor < 0) {
      throw new TypeError('Every amountMinor must be a non-negative safe integer');
    }
    if (item.currency !== currency) {
      throw new Error(`Currency mismatch: expected ${currency}, received ${item.currency}`);
    }

    const next = sum + item.amountMinor;
    if (!Number.isSafeInteger(next)) {
      throw new RangeError('Money total exceeds JavaScript safe integer range');
    }
    return next;
  }, 0);
}

export function splitCommission(amountMinor, partnerRateBps) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError('amountMinor must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(partnerRateBps) || partnerRateBps < 0 || partnerRateBps > 10_000) {
    throw new RangeError('partnerRateBps must be between 0 and 10000');
  }

  const partnerMinor = Math.floor((amountMinor * partnerRateBps) / 10_000);
  return {
    partnerMinor,
    platformMinor: amountMinor - partnerMinor,
  };
}
