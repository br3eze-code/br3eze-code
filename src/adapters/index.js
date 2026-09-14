/**
 * Public adapter surface. This module exports contracts/factories only;
 * concrete providers remain optional and are composed by the host.
 */
export { AgentOSFrameworkAdapter, assertAdapterContract } from './frameworks/AgentOSFrameworkAdapter.js';
export { A2AAdapter } from './protocols/A2AAdapter.js';
export { MCPAdapter } from './protocols/MCPAdapter.js';
export { default as MikroTikAdapter } from './network/mikrotik-adapter.js';
export * as NetworkDeviceAdapter from './network/mikrotik.js';
export * as OnboardingAdapter from './network/onboard.js';
export * as DatabaseAdapter from './persistence/database.js';
export * as FirebaseAdapter from './persistence/firebase.js';
