import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
const exec = promisify(execFile);
const platform = process.platform;

const run = async (command, args = []) => {
  try { const r = await exec(command, args, { timeout: 15000, windowsHide: true }); return r.stdout ?? ''; }
  catch (e) { const err = new Error(e.stderr?.trim() || e.message || 'Native Wi-Fi operation failed'); err.code = 'NATIVE_COMMAND_FAILED'; throw err; }
};

async function windows(op, a = {}) {
  if (op === 'scan') {
    const out = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
    return { raw: out, networks: [...out.matchAll(/SSID\s+\d+\s*:\s*(.*)/g)].map(m => ({ ssid: m[1].trim() })) };
  }
  if (op === 'status' || op === 'getConnectionInfo') return { raw: await run('netsh', ['wlan', 'show', 'interfaces']) };
  if (op === 'isWifiEnabled') return { enabled: !(await run('netsh', ['wlan', 'show', 'interfaces'])).includes('There is no wireless interface') };
  if (op === 'disconnect') return run('netsh', ['wlan', 'disconnect']);
  if (op === 'connect') return run('netsh', ['wlan', 'connect', `name=${a.profile || a.ssid}`]);
  throw Object.assign(new Error(`${op} is not supported on Windows`), { code: 'UNSUPPORTED_CAPABILITY' });
}

async function unix(op, a = {}) {
  const cmd = platform === 'darwin' ? 'networksetup' : 'nmcli';
  if (platform === 'darwin') {
    const dev = a.device || 'Wi-Fi';
    if (op === 'scan') return { raw: await run('airport', ['-s']).catch(() => run('networksetup', ['-listallhardwareports'])) };
    if (op === 'status' || op === 'getConnectionInfo') return { raw: await run('networksetup', ['-getinfo', dev]) };
    if (op === 'isWifiEnabled') return { enabled: (await run(cmd, ['-getairportpower', dev])).toLowerCase().includes('on') };
    if (op === 'setWifiEnabled') return run(cmd, ['-setairportpower', dev, a.enabled ? 'on' : 'off']);
    if (op === 'disconnect') return { ok: true, note: 'Use OS Wi-Fi controls to disconnect on macOS.' };
    if (op === 'connect') return run(cmd, ['-setairportnetwork', dev, a.ssid, a.password || '']);
  } else {
    if (op === 'scan') return { raw: await run('nmcli', ['-t', '-f', 'SSID,BSSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes']) };
    if (op === 'status' || op === 'getConnectionInfo') return { raw: await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']) };
    if (op === 'isWifiEnabled') return { enabled: (await run('nmcli', ['radio', 'wifi'])).trim() === 'enabled' };
    if (op === 'setWifiEnabled') return run('nmcli', ['radio', 'wifi', a.enabled ? 'on' : 'off']);
    if (op === 'disconnect') return run('nmcli', ['device', 'disconnect', a.device || 'wifi']);
    if (op === 'connect') return run('nmcli', ['device', 'wifi', 'connect', a.ssid, ...(a.password ? ['password', a.password] : [])]);
  }
  throw Object.assign(new Error(`${op} is not supported on ${platform}`), { code: 'UNSUPPORTED_CAPABILITY' });
}

export const capabilities = platform === 'win32'
  ? ['scan','connect','disconnect','status','isWifiEnabled','openWifiSettings','capabilities']
  : ['scan','connect','disconnect','status','isWifiEnabled','setWifiEnabled','openWifiSettings','capabilities'];

export async function nativeWifi(op, args = {}) {
  if (op === 'capabilities') return { platform, capabilities };
  if (op === 'openWifiSettings') {
    if (platform === 'win32') return run('start', ['ms-settings:network-wifi']);
    if (platform === 'darwin') return run('open', ['x-apple.systempreferences:com.apple.wifi-settings-extension']);
    return run('xdg-open', ['nm-connection-editor']);
  }
  return platform === 'win32' ? windows(op, args) : unix(op, args);
}

export function platformInfo() { return { platform, arch: os.arch(), release: os.release() }; }
