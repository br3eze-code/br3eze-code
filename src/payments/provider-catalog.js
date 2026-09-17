/**
 * Provider catalog is descriptive only. It does not claim merchant approval.
 * `adapterStatus` reflects this repository's integration state, not provider availability.
 */
export const PAYMENT_PROVIDER_CATALOG = Object.freeze({
  paynow: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'planned' },
  ecocash: { country: ['ZW'], rails: ['mobile_money'], sandbox: true, adapterStatus: 'planned' },
  onemoney: { country: ['ZW'], rails: ['mobile_money'], sandbox: false, adapterStatus: 'contract-required' },
  innbucks: { country: ['ZW'], rails: ['wallet'], sandbox: false, adapterStatus: 'contract-required' },
  omari: { country: ['ZW'], rails: ['wallet'], sandbox: false, adapterStatus: 'contract-required' },
  telecash: { country: ['ZW'], rails: ['mobile_money'], sandbox: false, adapterStatus: 'contract-required' },
  zimswitch: { country: ['ZW'], rails: ['card', 'bank'], sandbox: true, adapterStatus: 'planned' },
  zimswitch_online: { country: ['ZW'], rails: ['card'], sandbox: true, adapterStatus: 'planned' },
  pesapay: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'existing-adapter' },
  smilepay: { country: ['ZW'], rails: ['card', 'mobile_money', 'wallet'], sandbox: true, adapterStatus: 'planned' },
  contipay: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'contract-required' },
  linkwa: { country: ['ZW'], rails: ['card', 'mobile_money', 'wallet', 'payout'], sandbox: true, adapterStatus: 'planned' },
  finivex: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'planned' },
  payonify: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'planned' },
  zuripay: { country: ['ZW'], rails: ['card', 'mobile_money'], sandbox: false, adapterStatus: 'discontinued' },
  stripe: { country: ['*'], rails: ['card', 'wallet'], sandbox: true, adapterStatus: 'existing-adapter' },
});

export function getProviderCatalog(provider) {
  return PAYMENT_PROVIDER_CATALOG[String(provider || '').toLowerCase()] || null;
}

export function listZimbabweProviders() {
  return Object.entries(PAYMENT_PROVIDER_CATALOG)
    .filter(([, provider]) => provider.country.includes('ZW'))
    .map(([id, provider]) => ({ id, ...provider }));
}

export default PAYMENT_PROVIDER_CATALOG;
