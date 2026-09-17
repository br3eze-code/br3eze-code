/**
 * Domain-neutral merchant/payment policy.
 *
 * Provider credentials do not imply merchant eligibility. This policy keeps
 * country/provider availability explicit so a configured provider cannot be
 * exposed accidentally in a jurisdiction where the merchant is not approved.
 */

const ZIMBABWE = 'ZW';

// Stripe Payments is not currently available for merchants whose business
// country is Zimbabwe. Keep Stripe as an adapter for supported jurisdictions;
// never use a foreign account/address as a workaround.
const PROVIDER_COUNTRY_ALLOWLIST = Object.freeze({
  stripe: Object.freeze(['AE', 'AT', 'AU', 'BE', 'BG', 'BR', 'CA', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GB', 'GI', 'GR', 'HK', 'HR', 'HU', 'IE', 'IN', 'IT', 'JP', 'LI', 'LT', 'LU', 'LV', 'MT', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PL', 'PT', 'RO', 'SE', 'SG', 'SI', 'SK', 'TH', 'US']),
  paynow: Object.freeze([ZIMBABWE]),
  ecocash: Object.freeze([ZIMBABWE]),
  netone: Object.freeze([ZIMBABWE]),
  pesapay: Object.freeze([ZIMBABWE]),
  smilepay: Object.freeze([ZIMBABWE]),
  contipay: Object.freeze([ZIMBABWE]),
  zuripay: Object.freeze([ZIMBABWE]),
});

export function normalizeCountry(country) {
  return String(country || '').trim().toUpperCase() || ZIMBABWE;
}

export function isProviderAllowed(provider, country = ZIMBABWE) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedCountry = normalizeCountry(country);
  const allowlist = PROVIDER_COUNTRY_ALLOWLIST[normalizedProvider];

  // Unknown providers are not blocked by this registry; their own adapter is
  // responsible for credentials and eligibility. Known providers are explicit.
  if (!allowlist) return true;
  return allowlist.includes(normalizedCountry);
}

export function assertProviderAllowed(provider, country = ZIMBABWE) {
  if (!isProviderAllowed(provider, country)) {
    const normalizedCountry = normalizeCountry(country);
    throw new Error(`Payment provider '${provider}' is not enabled for merchant country '${normalizedCountry}'`);
  }
  return true;
}

export function applyPaymentProviderPolicy(config = {}) {
  const country = normalizeCountry(config.merchantCountry || config.country || process.env.MERCHANT_COUNTRY || ZIMBABWE);
  const blockedProviders = new Set(
    Array.isArray(config.disabledPaymentProviders)
      ? config.disabledPaymentProviders.map((provider) => String(provider).toLowerCase())
      : String(config.disabledPaymentProviders || process.env.DISABLED_PAYMENT_PROVIDERS || '')
          .split(',')
          .map((provider) => provider.trim().toLowerCase())
          .filter(Boolean)
  );

  for (const provider of Object.keys(PROVIDER_COUNTRY_ALLOWLIST)) {
    if (!isProviderAllowed(provider, country)) blockedProviders.add(provider);
  }

  return {
    ...config,
    merchantCountry: country,
    disabledPaymentProviders: [...blockedProviders],
  };
}

export { PROVIDER_COUNTRY_ALLOWLIST, ZIMBABWE };

export default {
  normalizeCountry,
  isProviderAllowed,
  assertProviderAllowed,
  applyPaymentProviderPolicy,
  PROVIDER_COUNTRY_ALLOWLIST,
  ZIMBABWE,
};
