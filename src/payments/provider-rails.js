/**
 * Payment rails are intentionally separate from gateway/provider adapters.
 * A gateway may expose several rails, and a rail may be reachable through several gateways.
 */
export const PAYMENT_RAILS = Object.freeze({
  card: ['visa', 'mastercard', 'zimswitch'],
  mobile_money: ['ecocash', 'onemoney', 'telecash'],
  wallet: ['innbucks', 'omari'],
  bank: ['zimswitch', 'paynow'],
  gateway: ['paynow', 'pesapay', 'smilepay', 'contipay', 'finivex', 'linkwa', 'payonify'],
});

export function providersForRail(rail) {
  return [...(PAYMENT_RAILS[String(rail || '').toLowerCase()] || [])];
}

export default PAYMENT_RAILS;
