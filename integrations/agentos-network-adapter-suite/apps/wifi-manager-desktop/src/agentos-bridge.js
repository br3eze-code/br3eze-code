import { NetworkAdapter, createToolDescriptors } from '../../../packages/agentos-network-adapter/src/index.mjs';
import { WifiManager } from './WifiManager.js';
import { capabilities } from './wifi-native.js';

export function createDesktopWifiAdapter() {
  const adapter = new NetworkAdapter({
    id: 'desktop-wifi',
    platform: process.platform,
    capabilities,
    transport: (operation, args = {}) => WifiManager[operation](args)
  });
  return { adapter, tools: createToolDescriptors(adapter) };
}
