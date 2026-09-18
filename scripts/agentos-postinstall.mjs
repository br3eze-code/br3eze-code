#!/usr/bin/env node
/**
 * AgentOS post-install hook.
 *
 * Deliberately does not copy credentials or API keys into shell startup files.
 * Runtime secrets belong in the process environment, a secret manager, or the
 * encrypted CLI credential store managed by `agentos login`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const isDocker = fs.existsSync('/.dockerenv') || Boolean(process.env.container);
const isWindows = process.platform === 'win32';

function shellConfigPath() {
  const home = os.homedir();
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (shell.includes('fish')) return path.join(home, '.config', 'fish', 'config.fish');
  const bashProfile = path.join(home, '.bash_profile');
  return fs.existsSync(bashProfile) ? bashProfile : path.join(home, '.bashrc');
}

function npmBinPath() {
  try {
    const prefix = execFileSync('npm', ['config', 'get', 'prefix'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return isWindows ? prefix : path.join(prefix, 'bin');
  } catch {
    return null;
  }
}

function ensureUnixPath(binPath) {
  const rcFile = shellConfigPath();
  const marker = '# AgentOS PATH';
  const current = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf8') : '';
  const pathLine = `export PATH="${binPath}:$PATH"`;
  if (current.includes(pathLine)) return;
  fs.mkdirSync(path.dirname(rcFile), { recursive: true });
  fs.appendFileSync(rcFile, `${current.endsWith('\\n') || !current ? '' : '\\n'}${marker}\\n${pathLine}\\n`);
  console.log(`[AgentOS] PATH configured in ${rcFile}; run: source ${rcFile}`);
}

function installLocalWrapper() {
  if (isWindows || isCI || isDocker) return null;
  const binPath = path.join(os.homedir(), '.local', 'bin');
  const wrapper = path.join(binPath, 'agentos');
  const entrypoint = path.resolve(process.cwd(), 'bin', 'agentos.js');
  if (!fs.existsSync(entrypoint)) return null;
  fs.mkdirSync(binPath, { recursive: true, mode: 0o700 });
  const script = `#!/usr/bin/env bash\\nset -Eeuo pipefail\\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(entrypoint)} "$@"\\n`;
  if (!fs.existsSync(wrapper) || fs.readFileSync(wrapper, 'utf8') !== script) {
    fs.writeFileSync(wrapper, script, { mode: 0o755 });
    fs.chmodSync(wrapper, 0o755);
    console.log(`[AgentOS] Local CLI wrapper installed at ${wrapper}`);
  }
  ensureUnixPath(binPath);
  return binPath;
}

function repairCordovaBrowser() {
  const root = process.env.INIT_CWD || process.cwd();
  const apiPath = path.join(root, 'node_modules', 'cordova-browser', 'bin', 'template', 'cordova', 'Api.js');
  const checkReqsPath = path.join(root, 'node_modules', 'cordova-browser', 'bin', 'lib', 'check_reqs.js');
  if (!fs.existsSync(apiPath) || !fs.existsSync(checkReqsPath)) return;
  const original = fs.readFileSync(apiPath, 'utf8');
  const repaired = original.replaceAll("require('./lib/check_reqs')", "require('../../lib/check_reqs')");
  if (repaired !== original) {
    fs.writeFileSync(apiPath, repaired);
    console.log('[AgentOS] Repaired cordova-browser template check_reqs path.');
  }
  const templateCordovaDir = path.dirname(apiPath);
  const packagePath = path.join(templateCordovaDir, 'package.json');
  if (!fs.existsSync(packagePath)) {
    fs.writeFileSync(packagePath, JSON.stringify({ type: 'commonjs' }, null, 2) + '\\n');
    console.log('[AgentOS] Added CommonJS boundary for cordova-browser platform API.');
  }
  const platformWwwDir = path.join(root, 'node_modules', 'cordova-browser', 'bin', 'template', 'platform_www');
  fs.mkdirSync(platformWwwDir, { recursive: true });
  const markerPath = path.join(platformWwwDir, '.gitkeep');
  if (!fs.existsSync(markerPath)) fs.writeFileSync(markerPath, '');
}

function ensureWindowsPath(binPath) {
  const current = process.env.PATH || '';
  if (current.toLowerCase().split(';').includes(binPath.toLowerCase())) return;
  try {
    const userPath = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '[Environment]::GetEnvironmentVariable("Path", "User")'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const entries = userPath ? userPath.split(';').filter(Boolean) : [];
    if (!entries.some(entry => entry.toLowerCase() === binPath.toLowerCase())) entries.push(binPath);
    const value = entries.join(';');
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `[Environment]::SetEnvironmentVariable("Path", ${JSON.stringify(value)}, "User")`
    ], { stdio: 'ignore' });
    console.log(`[AgentOS] User PATH updated with ${binPath}`);
  } catch {
    console.warn(`[AgentOS] Could not update Windows PATH automatically; add ${binPath} manually.`);
  }
}

try {
  const isGlobalInstall = !process.env.INIT_CWD || process.cwd().includes('node_modules');
  if (!isCI && !isDocker) {
    const binPath = isGlobalInstall ? npmBinPath() : installLocalWrapper();
    if (binPath) {
      if (isWindows) ensureWindowsPath(binPath);
      else ensureUnixPath(binPath);
    }
  }
  repairCordovaBrowser();
  console.log('[AgentOS] Post-install complete. Run `agentos onboard` or `agentos login`.');
} catch (error) {
  console.warn(`[AgentOS] Post-install setup skipped: ${error.message}`);
}
