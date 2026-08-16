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
  if (current.includes(marker)) return;
  fs.mkdirSync(path.dirname(rcFile), { recursive: true });
  fs.appendFileSync(rcFile, `\n${marker}\nexport PATH="${binPath}:$PATH"\n`);
  console.log(`[AgentOS] PATH configured in ${rcFile}; run: source ${rcFile}`);
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
  if (!isCI && !isDocker && isGlobalInstall) {
    const binPath = npmBinPath();
    if (binPath) {
      if (isWindows) ensureWindowsPath(binPath);
      else ensureUnixPath(binPath);
    }
  }
  console.log('[AgentOS] Post-install complete. Run `agentos onboard` or `agentos login`.');
} catch (error) {
  console.warn(`[AgentOS] Post-install setup skipped: ${error.message}`);
}
