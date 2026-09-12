import { NetworkAdapter, createToolDescriptors } from '../../../packages/agentos-network-adapter/src/index.mjs';
import { WifiManager } from './WifiManager.js';

export function createDesktopWifiAdapter() {
  const adapter = new NetworkAdapter({
    id: 'desktop-wifi', platform: process.platform,
    capabilities: ['scan','connect','disconnect','status','isWifiEnabled','setWifiEnabled','suggestConnection','removeSuggestion','requestPermissions','openWifiSettings','capabilities'],
    transport: (operation, args) => WifiManager[operation](args)
  });
  return { adapter, tools: createToolDescriptors(adapter) };
}
