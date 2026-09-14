/**
 * Backward-compatible Core shim.
 *
 * The actual provider boundary lives in ./ports/network-device.js.
 * Concrete network drivers are owned by src/adapters/network/.
 */
export {
  registerNetworkProvider,
  clearNetworkProvider,
  getNetworkProvider,
  createManager,
  getManager,
  resetManager,
  getClient as getMikroTikClient,
  testConnection,
  NetworkManagerFacade as MikroTikManager
} from './ports/network-device.js';

export class MikroTikError extends Error {}
export class ConnectionError extends MikroTikError {}
export class ToolExecutionError extends MikroTikError {}

export { NetworkManagerFacade as default } from './ports/network-device.js';
