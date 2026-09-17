/**
 * Domain-neutral merchant/payment policy.
 *
 * Provider credentials do not imply merchant eligibility. This policy keeps
 * country/provider availability explicit so a configured provider cannot be
 * exposed accidentally in a jurisdiction where the merchant is not approved.
 */

const ZIMBABWE = 'ZW';

// Zimbabwe is intentionally explicit here: Stripe Payments is not currently
// available to Zimbabwe-based merchants. Stripe remains a valid adapter for
// merchants in supported jurisdictions; this is not a workaround mechanism.
const PROVIDER_COUNTRY_RULES = Object.freeze({
  stripe: Object.freeze({ denied: [ZIMBABWE] }),
  paynow: Object.freeze({ allowed: [ZIMBABWE] }),
  ecocash: Object.freeze({ allowed: [ZIMBABWE] }),
  netone: Object.freeze({ allowed: [ZIMBABWE] }),
  pesapay: Object.freeze({ allowed: [ZIMBABWE] }),
  smilepay: Object.freeze({ allowed: [ZIMBABWE] }),
  contipay: Object.freeze({ allowed: [ZIMBABWE] }),
  zuripay: Object.freeze({ allowed: [ZIMBABWE] }),
});

const PROVIDER_CREDENTIALS = Object.freeze({
  stripe: ['stripeSecretKey', 'stripeWebhookSecret', 'stripePublishableKey'],
  paynow: ['paynowIntegrationId', 'paynowIntegrationKey'],
  ecocash: ['ecocashMerchantCode', 'ecocashApiKey'],
  netone: ['netoneApiKey', 'netoneMerchantId'],
  pesapay: ['pesapayConsumerKey'],
});

export function normalizeCountry(country) {
  return String(country || '').trim().toUpperCase() || ZIMBABWE;
}

export function isProviderAllowed(provider, country = ZIMBABWE) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedCountry = normalizeCountry(country);
  const rule = PROVIDER_COUNTRY_RULES[normalizedProvider];

  if (!rule) return true;
  if (rule.denied?.includes(normalizedCountry)) return false;
  if (rule.allowed) return rule.allowed.includes(normalizedCountry);
  return true;
}

export function assertProviderAllowed(provider, country = ZIMBABWE) {
  if (!isProviderAllowed(provider, country)) {
    const normalizedCountry = normalizeCountry(country);
    throw new Error(`Payment provider '${provider}' is not enabled for merchant country '${normalizedCountry}'`);
  }
  return true;
}

export function applyPaymentProviderPolicy(config = {}) {
  const country = normalizeCountry(
    config.merchantCountry || config.country || process.env.MERCHANT_COUNTRY || ZIMBABWE
  );
  const disabledProviders = new Set(
    Array.isArray(config.disabledPaymentProviders)
      ? config.disabledPaymentProviders.map((provider) => String(provider).toLowerCase())
      : String(config.disabledPaymentProviders || process.env.DISABLED_PAYMENT_PROVIDERS || '')
          .split(',')
          .map((provider) => provider.trim().toLowerCase())
          .filter(Boolean)
  );

  for (const provider of Object.keys(PROVIDER_COUNTRY_RULES)) {
    if (!isProviderAllowed(provider, country)) disabledProviders.add(provider);
  }

  // The existing gateway initializes providers from credential presence. Remove
  // credentials for policy-disabled providers so the legacy gateway cannot
  // accidentally expose a blocked provider without requiring a risky rewrite.
  const effectiveConfig = { ...config, merchantCountry: country, disabledPaymentProviders: [...disabledProviders] };
  for (const provider of disabledProviders) {
    for (const key of PROVIDER_CREDENTIALS[provider] || []) delete effectiveConfig[key];
  }

  return effectiveConfig;
}

export { PROVIDER_COUNTRY_RULES, PROVIDER_CREDENTIALS, ZIMBABWE };

export default {
  normalizeCountry,
  isProviderAllowed,
  assertProviderAllowed,
  applyPaymentProviderPolicy,
  PROVIDER_COUNTRY_RULES,
  PROVIDER_CREDENTIALS,
  ZIMBABWE,
};
