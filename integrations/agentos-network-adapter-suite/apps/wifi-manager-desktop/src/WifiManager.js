import { nativeWifi, capabilities, platformInfo } from './wifi-native.js';

const call = (operation, args = {}) => nativeWifi(operation, args);

export const WifiManager = Object.freeze({
  scan: () => call('scan'),
  connect: config => call('connect', config),
  disconnect: config => call('disconnect', config),
  getConnectionInfo: () => call('getConnectionInfo'),
  status: () => call('status'),
  isWifiEnabled: () => call('isWifiEnabled'),
  setWifiEnabled: enabled => call('setWifiEnabled', { enabled }),
  suggestConnection: config => Promise.resolve({ ok: false, code: 'UNSUPPORTED_CAPABILITY', message: 'Desktop operating systems manage saved Wi-Fi networks through their native network manager.' , config: { ssid: config?.ssid } }),
  removeSuggestion: () => Promise.reject(Object.assign(new Error('Desktop suggestion management is delegated to the OS network manager'), { code: 'UNSUPPORTED_CAPABILITY' })),
  requestPermissions: () => Promise.resolve({ granted: true, platform: platformInfo().platform }),
  openWifiSettings: () => call('openWifiSettings'),
  capabilities: () => Promise.resolve({ platform: platformInfo().platform, ...platformInfo(), capabilities }) ,
  isSupported: () => Promise.resolve(true)
});

export default WifiManager;
