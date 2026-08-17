/**
 * Protocol-neutral device management boundary.
 *
 * Device adapters are deliberately subordinate to AgentOS policy, approval,
 * tenant/site scope, and secret-management controls. They do not authorize
 * callers and they do not expose raw device credentials.
 */

function requireScope(scope = {}) {
  for (const field of ['tenantId', 'siteId', 'deviceId', 'principalId']) {
    if (scope[field] == null || scope[field] === '') throw new TypeError(`${field} is required`);
  }
}

export function assertDeviceActionScope({ scope, action, approved = false, secretRef = null } = {}) {
  requireScope(scope);
  if (typeof action !== 'string' || action.trim() === '') throw new TypeError('action is required');
  if (['applyBaseline', 'configure', 'activate'].includes(action) && approved !== true) {
    throw new Error(`approval required for device action: ${action}`);
  }
  if (['discover', 'captureFingerprint', 'verifyIdentity', 'applyBaseline', 'testConnectivity'].includes(action) && !secretRef) {
    throw new Error(`secret reference required for device action: ${action}`);
  }
  return Object.freeze({
    tenantId: String(scope.tenantId),
    siteId: String(scope.siteId),
    deviceId: String(scope.deviceId),
    principalId: String(scope.principalId),
    action
  });
}

export class DeviceAdapterRegistry {
  constructor() {
    this.adapters = new Map();
  }

  register(adapter) {
    if (!adapter || typeof adapter.type !== 'string' || adapter.type.trim() === '') throw new TypeError('adapter.type is required');
    for (const operation of ['discover', 'captureFingerprint', 'verifyIdentity', 'previewBaseline', 'applyBaseline', 'testConnectivity']) {
      if (typeof adapter[operation] !== 'function') throw new TypeError(`adapter.${operation} is required`);
    }
    if (this.adapters.has(adapter.type)) throw new Error(`device adapter already registered: ${adapter.type}`);
    this.adapters.set(adapter.type, adapter);
    return adapter.type;
  }

  get(type) {
    return this.adapters.get(type) || null;
  }
}

export default DeviceAdapterRegistry;
