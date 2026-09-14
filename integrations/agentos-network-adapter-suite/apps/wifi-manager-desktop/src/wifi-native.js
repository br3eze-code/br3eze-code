import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const platform = process.platform;

const run = async (command, args = [], options = {}) => {
  try {
    const r = await exec(command, args, { timeout: 15000, windowsHide: true, ...options });
    return r.stdout ?? '';
  } catch (e) {
    const err = new Error(e.stderr?.trim() || e.message || 'Native Wi-Fi operation failed');
    err.code = 'NATIVE_COMMAND_FAILED';
    err.command = command;
    throw err;
  }
};

const commandExists = command => {
  try {
    execFileSync(platform === 'win32' ? 'where.exe' : 'which', [command], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

const unsupported = (op, reason = `${op} is not supported on ${platform}`) => {
  throw Object.assign(new Error(reason), { code: 'UNSUPPORTED_CAPABILITY', details: { operation: op, platform } });
};

const xmlEscape = value => String(value ?? '').replace(/[<>&'\"]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));

async function connectWindows({ ssid, password, profile } = {}) {
  if (!ssid) throw Object.assign(new Error('ssid is required'), { code: 'INVALID_ARGUMENTS' });
  if (profile) return run('netsh', ['wlan', 'connect', `name=${profile}`]);

  const name = ssid;
  const hasPassword = typeof password === 'string' && password.length > 0;
  const profileXml = hasPassword
    ? `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xmlEscape(name)}</name>
  <SSIDConfig><SSID><name>${xmlEscape(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>manual</connectionMode>
  <MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
  <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${xmlEscape(password)}</keyMaterial></sharedKey>
  </security></MSM>
</WLANProfile>`
    : `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${xmlEscape(name)}</name>
  <SSIDConfig><SSID><name>${xmlEscape(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType><connectionMode>manual</connectionMode>
  <MSM><security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security></MSM>
</WLANProfile>`;

  const file = path.join(os.tmpdir(), `agentos-wifi-${randomUUID()}.xml`);
  try {
    await fs.writeFile(file, profileXml, { encoding: 'utf8', mode: 0o600 });
    await run('netsh', ['wlan', 'add', 'profile', `filename=${file}`, 'user=current']);
    return await run('netsh', ['wlan', 'connect', `name=${name}`]);
  } finally {
    await fs.rm(file, { force: true }).catch(() => {});
  }
}

async function windows(op, a = {}) {
  if (op === 'scan') {
    const out = await run('netsh', ['wlan', 'show', 'networks', 'mode=bssid']);
    return { raw: out, networks: [...out.matchAll(/SSID\s+\d+\s*:\s*(.*)/g)].map(m => ({ ssid: m[1].trim() })).filter(n => n.ssid) };
  }
  if (op === 'status' || op === 'getConnectionInfo') return { raw: await run('netsh', ['wlan', 'show', 'interfaces']) };
  if (op === 'isWifiEnabled') return { enabled: !(await run('netsh', ['wlan', 'show', 'interfaces'])).includes('There is no wireless interface') };
  if (op === 'disconnect') return run('netsh', ['wlan', 'disconnect']);
  if (op === 'connect') return connectWindows(a);
  unsupported(op);
}

async function unix(op, a = {}) {
  if (platform === 'darwin') {
    const dev = a.device || 'Wi-Fi';
    if (op === 'scan') {
      if (!commandExists('airport')) unsupported(op, 'macOS Wi-Fi scanning requires a supported airport command; hardware-port enumeration is not a network scan');
      const out = await run('airport', ['-s']);
      return { raw: out, networks: out.split('\n').slice(1).filter(Boolean) };
    }
    if (op === 'status' || op === 'getConnectionInfo') return { raw: await run('networksetup', ['-getinfo', dev]) };
    if (op === 'isWifiEnabled') return { enabled: (await run('networksetup', ['-getairportpower', dev])).toLowerCase().includes('on') };
    if (op === 'setWifiEnabled') return run('networksetup', ['-setairportpower', dev, a.enabled ? 'on' : 'off']);
    if (op === 'disconnect') return { ok: true, note: 'Use the native macOS network manager to disconnect the active Wi-Fi connection.' };
    if (op === 'connect') return run('networksetup', ['-setairportnetwork', dev, a.ssid, a.password || '']);
    unsupported(op);
  }

  if (!commandExists('nmcli')) unsupported(op, 'Linux NetworkManager (nmcli) is not installed or not on PATH');
  if (op === 'scan') return { raw: await run('nmcli', ['-t', '-f', 'SSID,BSSID,SIGNAL,SECURITY', 'device', 'wifi', 'list', '--rescan', 'yes']) };
  if (op === 'status' || op === 'getConnectionInfo') return { raw: await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']) };
  if (op === 'isWifiEnabled') return { enabled: (await run('nmcli', ['radio', 'wifi'])).trim() === 'enabled' };
  if (op === 'setWifiEnabled') return run('nmcli', ['radio', 'wifi', a.enabled ? 'on' : 'off']);
  if (op === 'disconnect') return run('nmcli', ['device', 'disconnect', a.device || 'wifi']);
  if (op === 'connect') {
    if (!a.ssid) throw Object.assign(new Error('ssid is required'), { code: 'INVALID_ARGUMENTS' });
    return run('nmcli', ['device', 'wifi', 'connect', a.ssid, ...(a.password ? ['password', a.password] : [])]);
  }
  unsupported(op);
}

const unixCapabilities = platform === 'darwin'
  ? ['connect', 'disconnect', 'status', 'getConnectionInfo', 'isWifiEnabled', 'setWifiEnabled', 'openWifiSettings', 'capabilities', ...(commandExists('airport') ? ['scan'] : [])]
  : commandExists('nmcli')
    ? ['scan', 'connect', 'disconnect', 'status', 'getConnectionInfo', 'isWifiEnabled', 'setWifiEnabled', 'openWifiSettings', 'capabilities']
    : ['capabilities'];

export const capabilities = platform === 'win32'
  ? ['scan', 'connect', 'disconnect', 'status', 'getConnectionInfo', 'isWifiEnabled', 'openWifiSettings', 'capabilities']
  : unixCapabilities;

export async function nativeWifi(op, args = {}) {
  if (op === 'capabilities') return { platform, capabilities: [...capabilities], backend: platform === 'win32' ? 'netsh' : platform === 'darwin' ? 'networksetup/airport' : commandExists('nmcli') ? 'nmcli' : null };
  if (op === 'openWifiSettings') {
    if (platform === 'win32') return run('explorer.exe', ['ms-settings:network-wifi']);
    if (platform === 'darwin') return run('open', ['x-apple.systempreferences:com.apple.wifi-settings-extension']);
    if (commandExists('nm-connection-editor')) return run('nm-connection-editor', []);
    if (commandExists('xdg-open')) return run('xdg-open', ['network:///']);
    unsupported(op, 'No supported Linux network settings application was found');
  }
  return platform === 'win32' ? windows(op, args) : unix(op, args);
}

export function isSupported() { return capabilities.some(op => ['scan', 'connect', 'status'].includes(op)); }
export function platformInfo() { return { platform, arch: os.arch(), release: os.release() }; }
