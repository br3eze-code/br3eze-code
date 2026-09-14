import { nativeWifi, capabilities, platformInfo, isSupported } from './wifi-native.js';

const call = (operation, args = {}) => nativeWifi(operation, args);

export const WifiManager = Object.freeze({
  scan: () => call('scan'),
  connect: config => call('connect', config),
  disconnect: config => call('disconnect', config),
  getConnectionInfo: () => call('getConnectionInfo'),
  status: () => call('status'),
  isWifiEnabled: () => call('isWifiEnabled'),
  setWifiEnabled: enabled => call('setWifiEnabled', { enabled }),
  suggestConnection: config => Promise.reject(Object.assign(new Error('Desktop suggestion management is delegated to the OS network manager'), { code: 'UNSUPPORTED_CAPABILITY', details: { ssid: config?.ssid } })),
  removeSuggestion: () => Promise.reject(Object.assign(new Error('Desktop suggestion management is delegated to the OS network manager'), { code: 'UNSUPPORTED_CAPABILITY' })),
  requestPermissions: () => Promise.resolve({ granted: true, platform: platformInfo().platform }),
  openWifiSettings: () => call('openWifiSettings'),
  capabilities: () => call('capabilities'),
  isSupported: () => isSupported()
});

export default WifiManager;
