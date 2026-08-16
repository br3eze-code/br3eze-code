import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { jest } from '@jest/globals';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function loadCommonJsBridge(relativePath, { cordova, exec } = {}) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
    .replace(/export default WiFiBillingAgent;\s*$/, 'module.exports = WiFiBillingAgent;')
    .replace(/export default AICore;\s*$/, 'module.exports.default = AICore;');
  const module = { exports: {} };
  const window = { Promise };
  const context = {
    module,
    exports: module.exports,
    window,
    console,
    Promise,
    cordova,
    require(request) {
      if (request === 'cordova/exec') return exec;
      if (request === 'cordova-plugin-promise-polyfill') return { Promise };
      throw new Error(`Unexpected bridge dependency: ${request}`);
    },
  };
  vm.runInNewContext(source, context, { filename: relativePath });
  return module.exports;
}

describe('Cordova platform parity and domain boundaries', () => {
  test('application metadata is AgentOS-neutral while retaining the existing upgrade identity', () => {
    const config = fs.readFileSync(path.join(repoRoot, 'config.xml'), 'utf8');
    expect(config).toContain('id="africa.br3eze"');
    expect(config).toContain('<name>AgentOS</name>');
    expect(config).toContain('Cross-platform agent runtime');
    expect(config).not.toContain('<name>Power Connect</name>');
    expect(config).not.toContain('WiFi Billing System by Br3eze Africa');
  });

  test('custom plugin manifests map every declared native source file to an existing file', () => {
    const pluginDirs = [
      'custom-plugins/cordova-plugin-aicore',
      'custom-plugins/cordova-plugin-network-tools',
      'custom-plugins/cordova-plugin-wifi-billing-agent',
    ];

    for (const pluginDir of pluginDirs) {
      const manifestPath = path.join(repoRoot, pluginDir, 'plugin.xml');
      const manifest = fs.readFileSync(manifestPath, 'utf8');
      expect(manifest).toContain('xmlns="http://apache.org/cordova/ns/plugins/1.0"');

      const declaredFiles = [...manifest.matchAll(/(?:source-file|js-module)\s+src="([^"]+)"/g)]
        .map(([, relative]) => relative);
      expect(declaredFiles.length).toBeGreaterThan(0);
      for (const relative of declaredFiles) {
        expect(fs.existsSync(path.join(repoRoot, pluginDir, relative))).toBe(true);
      }

      for (const [, relative, targetDir] of manifest.matchAll(/<source-file\s+src="([^"]+\.java)"\s+target-dir="([^"]+)"\s*\/>/g)) {
        const source = fs.readFileSync(path.join(repoRoot, pluginDir, relative), 'utf8');
        const packageName = source.match(/^package\s+([\w.]+);/m)?.[1];
        const expectedPackage = targetDir.replace(/^src\//, '').replaceAll('/', '.');
        expect(packageName).toBe(expectedPackage);
      }

      if (pluginDir.endsWith('cordova-plugin-wifi-billing-agent')) {
        expect(manifest).not.toContain('WiFi Billing Agent needs');
        expect(manifest).not.toContain('Power Connect');
      }
    }
  });

  test('Network Tools returns an explicit web fallback outside Cordova', async () => {
    const bridge = loadCommonJsBridge('custom-plugins/cordova-plugin-network-tools/www/NetworkTools.js');
    await expect(bridge.capabilities()).resolves.toMatchObject({
      supported: false,
      platform: 'web',
      action: 'capabilities',
      nativeReady: false,
      code: 'NATIVE_BRIDGE_UNAVAILABLE',
    });
    expect(() => bridge.execute('')).toThrow('NetworkTools.execute requires a tool name');
  });

  test('AI Core returns structured native-unavailable fallbacks outside Cordova', async () => {
    const bridge = loadCommonJsBridge('custom-plugins/cordova-plugin-aicore/www/AICore.js');
    await expect(bridge.request({ prompt: 'hello' })).rejects.toMatchObject({
      supported: false,
      nativeReady: false,
      platform: 'web',
      action: 'request',
      code: 'NATIVE_BRIDGE_UNAVAILABLE',
    });
    await expect(new Promise((resolve, reject) => {
      bridge.default.checkAvailability(resolve, reject);
    })).rejects.toMatchObject({ action: 'checkAvailability', code: 'NATIVE_BRIDGE_UNAVAILABLE' });
  });

  test('Network Tools preserves authorized context and dispatches native requests', async () => {
    const calls = [];
    const exec = (resolve, _reject, service, action, args) => {
      calls.push({ service, action, args });
      resolve({ ok: true, service, action });
    };
    const bridge = loadCommonJsBridge(
      'custom-plugins/cordova-plugin-network-tools/www/NetworkTools.js',
      { cordova: {}, exec },
    );

    await expect(bridge.execute('network.interfaces', { includeVirtual: false }, {
      tenantId: 'tenant-a',
      siteId: 'site-1',
      role: 'operator',
    })).resolves.toMatchObject({ ok: true });

    expect(calls).toEqual([{
      service: 'AgentOSNetworkTools',
      action: 'agentRequest',
      args: [{
        tool: 'network.interfaces',
        params: { includeVirtual: false },
        context: {
          tenantId: 'tenant-a',
          siteId: 'site-1',
          role: 'operator',
          source: 'cordova',
        },
      }],
    }]);
  });

  test('WiFi bridge returns structured native-unavailable fallbacks outside Cordova', async () => {
    const bridge = loadCommonJsBridge(
      'custom-plugins/cordova-plugin-wifi-billing-agent/www/WifiBillingAgent.js',
    );
    await expect(bridge.initialize({ tenantId: 'tenant-web' })).rejects.toMatchObject({
      supported: false,
      nativeReady: false,
      platform: 'web',
      action: 'initialize',
      code: 'NATIVE_BRIDGE_UNAVAILABLE',
    });
  });

  test('WiFi bridge has no product endpoint, SSID, or identity prefix defaults', () => {
    const bridge = loadCommonJsBridge(
      'custom-plugins/cordova-plugin-wifi-billing-agent/www/WifiBillingAgent.js',
      { cordova: {}, exec: jest.fn() },
    );

    expect(bridge.defaultConfig.preferredNetworks).toEqual([]);
    expect(bridge.defaultConfig.apiEndpoint).toBeNull();
    expect(bridge.defaultConfig.agentIdPrefix).toBe('agentos-agent-');
    expect(bridge._isBillingNetwork('PowerConnect-Guest')).toBe(false);
    expect(bridge._generateAgentId()).toMatch(/^agentos-agent-/);
  });

  test('WiFi bridge supports tenant/site metadata and opt-in matchers', () => {
    const bridge = loadCommonJsBridge(
      'custom-plugins/cordova-plugin-wifi-billing-agent/www/WifiBillingAgent.js',
      { cordova: {}, exec: jest.fn() },
    );
    bridge._config = {
      tenantId: 'tenant-b',
      siteId: 'site-2',
      networkMatchers: [/^customer-/i, (ssid) => ssid.endsWith('-mesh')],
      agentIdPrefix: 'tenant-b-agent-',
    };

    expect(bridge._isBillingNetwork('Customer-HQ')).toBe(true);
    expect(bridge._isBillingNetwork('edge-mesh')).toBe(true);
    expect(bridge._isBillingNetwork('unrelated-network')).toBe(false);
    expect(bridge._generateAgentId()).toMatch(/^tenant-b-agent-/);
  });
});
