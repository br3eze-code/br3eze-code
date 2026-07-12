#!/usr/bin/env node
'use strict';
/**
 * AgentOS Post-install
 * - Global installs (npm install -g): configures PATH + system env vars
 * - Local dev / CI / Docker: exits silently after installing system env vars
 *   from the project .env file so the gateway can read them without dotenv
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

const isCI     = !!(process.env.CI || process.env.GITHUB_ACTIONS);
const isDocker = fs.existsSync('/.dockerenv') || !!process.env.container;
const isWin    = process.platform === 'win32';

// ── Parse .env file (no dotenv dependency needed here) ───────────────────────
function parseDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const vars = {};
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let   val = line.slice(eq + 1).trim();
    // Strip optional surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) vars[key] = val;
  }
  return vars;
}

// ── Variables to promote to system/user environment ──────────────────────────
// These are the vars the gateway reads at startup — making them system vars
// means the service can run without dotenv loading the .env file.
const SYSTEM_VARS = [
  'PORT',
  'HOST',
  'NODE_ENV',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_DATABASE_URL',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_API_KEY',
  'GEMINI_API_KEY',
  'TELEGRAM_TOKEN',
  'AGENTOS_GATEWAY_TOKEN',
  'VAULT_MASTER_KEY',
  'ALLOWED_ORIGINS',
  'WHATSAPP_ENABLED',
  'WHATSAPP_AUTH_DIR',
  'PRINTER_ENABLED',
  'PRINTER_INTERFACE',
  'AGENTOS_NODE_URL',
];

// ── Windows: setx writes to user-level environment (persists across reboots) ─
function setWindowsUserVar(key, value) {
  if (!value || value.includes('your_')) return; // skip placeholder values
  try {
    // setx has a 1024-char limit per value — skip oversized values
    if (value.length > 1024) return;
    execFileSync('setx', [key, value], { stdio: 'ignore' });
  } catch {
    // setx may not be available in all contexts — non-fatal
  }
}

// ── Unix: append export lines to shell rc file ────────────────────────────────
function getShellConfig() {
  const shell = process.env.SHELL || '';
  const home  = os.homedir();
  if (shell.includes('zsh'))  return path.join(home, '.zshrc');
  if (shell.includes('fish')) return path.join(home, '.config', 'fish', 'config.fish');
  const bp = path.join(home, '.bash_profile');
  return fs.existsSync(bp) ? bp : path.join(home, '.bashrc');
}

function ensureUnixVar(key, value, configFile) {
  if (!value || value.includes('your_')) return;
  try {
    const current = fs.existsSync(configFile)
      ? fs.readFileSync(configFile, 'utf8') : '';
    const marker = `# AgentOS:${key}`;
    if (current.includes(marker)) return; // already set
    // Escape special chars for shell
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    fs.appendFileSync(configFile, `\n${marker}\nexport ${key}="${escaped}"\n`);
  } catch {
    // Non-fatal
  }
}

// ── PATH setup (global installs only) ────────────────────────────────────────
function detectNpmBin() {
  try {
    const prefix = execFileSync('npm', ['config', 'get', 'prefix'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return isWin ? prefix : path.join(prefix, 'bin');
  } catch {
    return null;
  }
}

function ensureInPath(binPath) {
  if (isWin) {
    // Windows: add to user PATH via setx
    const currentPath = process.env.PATH || '';
    if (!currentPath.includes(binPath)) {
      try {
        execFileSync('setx', ['PATH', `${binPath};${currentPath}`], { stdio: 'ignore' });
        console.log(`[AgentOS] PATH updated (${binPath})`);
      } catch { /* non-fatal */ }
    }
    return;
  }
  const configFile  = getShellConfig();
  const exportLine  = `\n# AgentOS PATH\nexport PATH="${binPath}:$PATH"\n`;
  try {
    if (fs.existsSync(configFile)) {
      if (fs.readFileSync(configFile, 'utf8').includes('AgentOS PATH')) return;
    }
    fs.appendFileSync(configFile, exportLine);
    console.log(`[AgentOS] PATH configured in ${configFile}`);
    console.log(`[AgentOS] Run: source ${configFile}`);
  } catch {
    console.log(`[AgentOS] Could not configure PATH — add ${binPath} to PATH manually`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
try {
  // Locate .env relative to project root (INIT_CWD during npm install)
  const projectRoot = process.env.INIT_CWD || process.cwd();
  const envPath     = path.join(projectRoot, '.env');
  const envVars     = parseDotEnv(envPath);

  if (Object.keys(envVars).length > 0) {
    let installed = 0;

    if (isWin) {
      for (const key of SYSTEM_VARS) {
        const value = envVars[key];
        if (value) { setWindowsUserVar(key, value); installed++; }
      }
      if (installed > 0) {
        console.log(`[AgentOS] ${installed} environment variable(s) written to user environment (setx).`);
        console.log('[AgentOS] Open a new terminal for changes to take effect.');
      }
    } else if (!isCI && !isDocker) {
      const configFile = getShellConfig();
      for (const key of SYSTEM_VARS) {
        const value = envVars[key];
        if (value) { ensureUnixVar(key, value, configFile); installed++; }
      }
      if (installed > 0) {
        console.log(`[AgentOS] ${installed} environment variable(s) written to ${configFile}`);
        console.log(`[AgentOS] Run: source ${configFile}`);
      }
    }
  }

  // PATH setup — only meaningful for true global installs
  const isLocalDev = process.env.INIT_CWD && process.env.INIT_CWD === process.cwd();
  const isGlobal   = !process.env.INIT_CWD || process.cwd().includes('node_modules');

  if (!isCI && !isDocker && !isLocalDev && isGlobal) {
    const binPath = detectNpmBin();
    if (binPath && !(process.env.PATH || '').includes(binPath)) {
      ensureInPath(binPath);
    }
  }

  console.log('[AgentOS] Post-install complete. Run: agentos onboard');
} catch (_err) {
  // Never fail an install due to post-install setup issues
}
