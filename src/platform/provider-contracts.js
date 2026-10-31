const METHOD_BY_KIND = Object.freeze({
  model: 'execute',
  storage: 'get',
  network: 'request',
  hardware: 'probe',
  messaging: 'send',
  identity: 'authenticate',
  custom: 'initialize',
});

/** Validate the SPI method required for a provider's declared kind. */
export function validateProviderImplementation(provider) {
  const method = METHOD_BY_KIND[provider?.kind];
  if (!method) throw new TypeError(`unsupported provider kind: ${provider?.kind}`);
  if (typeof provider[method] !== 'function') {
    throw new TypeError(`provider kind "${provider.kind}" must implement ${method}()`);
  }
  return provider;
}

export function requiredProviderMethod(kind) {
  return METHOD_BY_KIND[kind] ?? null;
}
