/**
 * Small domain-neutral provider registry used by Core ports.
 * Providers are owned and instantiated by the host/adapters layer.
 */
export function createProviderPort(name) {
  let provider = null;
  const requireProvider = () => {
    if (!provider) throw new Error(`No ${name} provider registered`);
    return provider;
  };
  return Object.freeze({
    register(next) {
      if (!next) throw new TypeError(`${name} provider is required`);
      provider = next;
      return provider;
    },
    clear() { provider = null; },
    get() { return provider; },
    require: requireProvider
  });
}
