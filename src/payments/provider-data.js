/**
 * Phase G canonical provider reference data.
 *
 * Rates are intentionally nullable until contract-confirmed tariffs are loaded.
 * Never infer a live merchant fee from this file. `status` distinguishes
 * integration/catalog state from commercial approval and pricing.
 */

export const PAYMENT_PROVIDER_CAPABILITIES = Object.freeze([
  { provider: 'paynow', country: 'ZW', rails: ['card', 'mobile_money', 'bank'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'ecocash', country: 'ZW', rails: ['mobile_money'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'onemoney', country: 'ZW', rails: ['mobile_money'], operations: ['createPayment', 'webhook'], status: 'contract-required' },
  { provider: 'innbucks', country: 'ZW', rails: ['wallet'], operations: ['createPayment', 'webhook'], status: 'contract-required' },
  { provider: 'omari', country: 'ZW', rails: ['wallet'], operations: ['createPayment', 'webhook'], status: 'contract-required' },
  { provider: 'telecash', country: 'ZW', rails: ['mobile_money'], operations: ['createPayment', 'webhook'], status: 'contract-required' },
  { provider: 'zimswitch', country: 'ZW', rails: ['card', 'bank'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'zimswitch_online', country: 'ZW', rails: ['card'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'pesapay', country: 'ZW', rails: ['card', 'mobile_money', 'bank'], operations: ['createPayment', 'webhook'], status: 'existing-adapter' },
  { provider: 'smilepay', country: 'ZW', rails: ['card', 'mobile_money', 'wallet'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'contipay', country: 'ZW', rails: ['card', 'mobile_money', 'bank'], operations: ['createPayment', 'webhook'], status: 'contract-required' },
  { provider: 'linkwa', country: 'ZW', rails: ['card', 'mobile_money', 'wallet', 'payout'], operations: ['createPayment', 'webhook', 'payout'], status: 'planned' },
  { provider: 'finivex', country: 'ZW', rails: ['card', 'mobile_money', 'bank'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'payonify', country: 'ZW', rails: ['card', 'mobile_money', 'bank'], operations: ['createPayment', 'webhook'], status: 'planned' },
  { provider: 'zuripay', country: 'ZW', rails: ['card', 'mobile_money'], operations: [], status: 'discontinued' },
  { provider: 'stripe', country: '*', rails: ['card', 'wallet'], operations: ['createPayment', 'webhook', 'refund'], status: 'existing-adapter' },
]);

export const PAYMENT_PROVIDER_RATES = Object.freeze([]);

export function listProviderCapabilities({ country = 'ZW' } = {}) {
  const c = String(country).toUpperCase();
  return PAYMENT_PROVIDER_CAPABILITIES.filter((row) => row.country === '*' || row.country === c);
}

export function listProviderRates({ provider, country = 'ZW' } = {}) {
  return PAYMENT_PROVIDER_RATES.filter((row) => (!provider || row.provider === provider) && (!country || row.country === String(country).toUpperCase()));
}
