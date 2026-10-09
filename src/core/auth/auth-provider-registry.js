/**
 * Domain-agnostic authentication provider registry.
 * OAuth/OIDC vendors are adapters; the core only understands capabilities and
 * normalized identity claims.
 */
export class AuthProviderRegistry {
  constructor({ providers = [] } = {}) {
    this.providers = new Map();
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    if (!provider?.id || typeof provider.authorize !== 'function') {
      throw new TypeError('Auth provider requires id and authorize()');
    }
    this.providers.set(String(provider.id), provider);
    return provider;
  }

  get(id) { return this.providers.get(String(id)); }

  list() {
    return [...this.providers.values()].map(({ id, protocol = 'oauth2', capabilities = [] }) => ({ id, protocol, capabilities: [...capabilities] }));
  }

  require(id) {
    const provider = this.get(id);
    if (!provider) throw new Error(`Unknown authentication provider: ${id}`);
    return provider;
  }
}

export function normalizeIdentity({ issuer, subject, email, name, claims = {}, provider }) {
  if (!issuer || !subject) throw new TypeError('Normalized identity requires issuer and subject');
  return Object.freeze({
    issuer: String(issuer),
    subject: String(subject),
    provider: provider ? String(provider) : undefined,
    email: email ? String(email).toLowerCase() : undefined,
    name: name ? String(name) : undefined,
    claims: Object.freeze({ ...claims })
  });
}

export default AuthProviderRegistry;
