let provider = null;
export function registerFinancialProvider(implementation) { if (typeof implementation !== 'function') throw new TypeError('Financial provider must be a constructor'); provider = implementation; return provider; }
export function getFinancialProvider() { if (!provider) throw new Error('No financial provider registered'); return provider; }
export default class FinancialController {
  constructor(config = {}) { const Provider = getFinancialProvider(); return new Provider(config); }
}
