/**
 * Domain-neutral Core ports.
 *
 * These modules define capability boundaries only. Concrete implementations
 * belong under src/adapters (or an external plugin) and are registered by the host.
 */
export * from './provider-registry.js';
export * from './network-device.js';
export * from './billing.js';
export * from './finance.js';
export * from './persistence.js';
