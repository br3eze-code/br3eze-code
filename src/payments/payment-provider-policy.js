/**
 * Domain-neutral merchant/payment policy.
 * Provider credentials do not imply merchant eligibility.
 */

const ZIMBABWE = 'ZW';

const PROVIDER_COUNTRY_RULES = Object.freeze({
  stripe: Object.freeze({ denied: [ZIMBABWE] }),
  paynow: Object.freeze({ allowed: [ZIMBABWE] }),
  ecocash: Object.freeze({ allowed: [ZIMBABWE] }),
  netone: Object.freeze({ allowed: [ZIMBABWE] }),
  onemoney: Object.freeze({ allowed: [ZIMBABWE] }),
  innbucks: Object.freeze({ allowed: [ZIMBABWE] }),
  omari: Object.freeze({ allowed: [ZIMBABWE] }),
  telecash: Object.freeze({ allowed: [ZIMBABWE] }),
  zimswitch: Object.freeze({ allowed: [ZIMBABWE] }),
  zimswitch_online: Object.freeze({ allowed: [ZIMBABWE] }),
  pesapay: Object.freeze({ allowed: [ZIMBABWE] }),
  smilepay: Object.freeze({ allowed: [ZIMBABWE] }),
  contipay: Object.freeze({ allowed: [ZIMBABWE] }),
  linkwa: Object.freeze({ allowed: [ZIMBABWE] }),
  finivex: Object.freeze({ allowed: [ZIMBABWE] }),
  payonify: Object.freeze({ allowed: [ZIMBABWE] }),
  zuripay: Object.freeze({ allowed: [ZIMBABWE] }),
});

const PROVIDER_CREDENTIALS = Object.freeze({
  stripe: ['stripeSecretKey', 'stripeWebhookSecret', 'stripePublishableKey'],
  paynow: ['paynowIntegrationId', 'paynowIntegrationKey'],
  ecocash: ['ecocashMerchantCode', 'ecocashApiKey'],
  netone: ['netoneApiKey', 'netoneMerchantId'],
  onemoney: ['onemoneyApiKey', 'onemoneyMerchantId'],
  innbucks: ['innbucksApiKey', 'innbucksMerchantId'],
  omari: ['omariApiKey', 'omariMerchantId'],
  telecash: ['telecashApiKey', 'telecashMerchantId'],
  zimswitch: ['zimswitchEntityId', 'zimswitchAuthorizationBearer'],
  zimswitch_online: ['zimswitchEntityId', 'zimswitchAuthorizationBearer'],
  pesapay: ['pesapayConsumerKey'],
  smilepay: ['smilepayApiKey', 'smilepayApiSecret'],
  contipay: ['contipayApiKey', 'contipayApiSecret'],
  linkwa: ['linkwaApiKey', 'linkwaApiSecret'],
  finivex: ['finivexApiKey', 'finivexApiSecret'],
  payonify: ['payonifyApiKey', 'payonifyApiSecret'],
});

export function normalizeCountry(country) {
  return String(country || '').trim().toUpperCase() || ZIMBABWE;
}

export function isProviderAllowed(provider, country = ZIMBABWE) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedCountry = normalizeCountry(country);
  const rule = PROVIDER_COUNTRY_RULES[normalizedProvider];

  if (!rule) return true;
  if (rule.denied?.includes('*') || rule.denied?.includes(normalizedCountry)) return false;
  if (rule.allowed) return rule.allowed.includes(normalizedCountry);
  return true;
}

export function assertProviderAllowed(provider, country = ZIMBABWE) {
  if (!isProviderAllowed(provider, country)) {
    throw new Error(`Payment provider '${provider}' is not enabled for merchant country '${normalizeCountry(country)}'`);
  }
  return true;
}

export function applyPaymentProviderPolicy(config = {}) {
  const country = normalizeCountry(config.merchantCountry || config.country || process.env.MERCHANT_COUNTRY || ZIMBABWE);
  const disabledProviders = new Set(
    Array.isArray(config.disabledPaymentProviders)
      ? config.disabledPaymentProviders.map((provider) => String(provider).toLowerCase())
      : String(config.disabledPaymentProviders || process.env.DISABLED_PAYMENT_PROVIDERS || '')
          .split(',').map((provider) => provider.trim().toLowerCase()).filter(Boolean)
  );

  for (const provider of Object.keys(PROVIDER_COUNTRY_RULES)) {
    if (!isProviderAllowed(provider, country)) disabledProviders.add(provider);
  }

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
