/**
 * Declarative integration catalog. Entries are metadata only; credentials,
 * endpoints and SDKs belong to adapters/configuration, never the domain core.
 */
export const AUTH_PROVIDER_CATALOG = Object.freeze([
  { id: 'google', protocol: 'oidc', capabilities: ['login', 'identity'] },
  { id: 'microsoft', protocol: 'oidc', capabilities: ['login', 'identity', 'enterprise'] },
  { id: 'github', protocol: 'oauth2', capabilities: ['login', 'identity'] },
  { id: 'apple', protocol: 'oidc', capabilities: ['login', 'identity'] },
  { id: 'generic-oidc', protocol: 'oidc', capabilities: ['login', 'identity'] },
  { id: 'generic-oauth2', protocol: 'oauth2', capabilities: ['authorization'] }
]);

export const COURIER_CAPABILITY_CATALOG = Object.freeze([
  { id: 'dhl', capabilities: ['quote', 'createShipment', 'label', 'track', 'return'] },
  { id: 'fedex', capabilities: ['quote', 'createShipment', 'label', 'track', 'return'] },
  { id: 'ups', capabilities: ['quote', 'createShipment', 'label', 'track', 'return'] },
  { id: 'aramex', capabilities: ['quote', 'createShipment', 'label', 'track', 'return'] },
  { id: 'custom', capabilities: ['quote', 'createShipment', 'track'] }
]);

export function providersWithCapability(catalog, capability) {
  return catalog.filter(provider => provider.capabilities?.includes(capability));
}
