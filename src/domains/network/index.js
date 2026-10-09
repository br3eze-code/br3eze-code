import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import BaseDomain from '../BaseDomain.js';

const execFileAsync = promisify(execFile);

function validateHost(host) {
  if (typeof host !== 'string' || !host.trim() || !/^[A-Za-z0-9_.:-]+$/.test(host)) {
    throw new TypeError('host must be a valid hostname or IP address');
  }
  return host.trim();
}

class NetworkDomain extends BaseDomain {
  constructor() {
    super();
    this.name = 'network';
    this.registerTool({
      name: 'ping',
      description: 'Test connectivity to a host using the operating system ping utility',
      execute: async (host = '8.8.8.8') => {
        const target = validateHost(host);
        const args = process.platform === 'win32' ? ['-n', '1', '-w', '3000', target] : ['-c', '1', '-W', '3', target];
        const started = Date.now();
        try {
          const { stdout } = await execFileAsync('ping', args, { timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 });
          return { host: target, status: 'reachable', latencyMs: Date.now() - started, output: stdout.trim().slice(0, 1000) };
        } catch (error) {
          return { host: target, status: 'unreachable', latencyMs: Date.now() - started, error: error.code || error.message };
        }
      },
    });
    this.registerTool({
      name: 'monitor',
      description: 'Inspect local network interfaces and their operational addresses',
      execute: async (iface = null) => {
        const interfaces = os.networkInterfaces();
        const names = iface ? [iface] : Object.keys(interfaces);
        return names.map((name) => ({
          interface: name,
          exists: Boolean(interfaces[name]),
          addresses: (interfaces[name] || []).map(({ address, family, internal, netmask, mac }) => ({ address, family, internal, netmask, mac })),
          status: interfaces[name]?.length ? 'up' : 'down',
        }));
      },
    });
  }
}

export default NetworkDomain;
