/**
 * Provider catalog is descriptive only. It does not claim API access or merchant approval.
 * Availability must be confirmed by the adapter configuration and merchant contract.
 */
export const PAYMENT_PROVIDER_CATALOG = Object.freeze({
  paynow: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'planned' },
  ecocash: { country: ['ZW'], rails: ['mobile_money'], sandbox: true, adapterStatus: 'planned' },
  smilepay: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'planned' },
  contipay: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: false, adapterStatus: 'contract-required' },
  zuripay: { country: ['ZW'], rails: ['card', 'mobile_money'], sandbox: false, adapterStatus: 'contract-required' },
  pesapal: { country: ['ZW'], rails: ['card', 'mobile_money', 'bank'], sandbox: true, adapterStatus: 'existing-adapter' },
  onemoney: { country: ['ZW'], rails: ['mobile_money'], sandbox: false, adapterStatus: 'contract-required' },
  zimswitch: { country: ['ZW'], rails: ['card', 'bank'], sandbox: false, adapterStatus: 'contract-required' },
  stripe: { country: ['*'], rails: ['card', 'wallet'], sandbox: true, adapterStatus: 'existing-adapter' },
});

export function getProviderCatalog(provider) {
  return PAYMENT_PROVIDER_CATALOG[String(provider || '').toLowerCase()] || null;
}

export default PAYMENT_PROVIDER_CATALOG;
