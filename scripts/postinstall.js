#!/usr/bin/env node
'use strict';
/**
 * AgentOS Post-install
 * Only runs for GLOBAL installs (npm install -g br3eze-code).
 * Silently no-ops in all other contexts (Docker, CI, local dev).
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Skip everything except true global installs ───────────────────────────────
const isCI          = process.env.CI || process.env.GITHUB_ACTIONS;
const isDocker      = fs.existsSync('/.dockerenv') || process.env.container;
const isLocalDev    = process.env.INIT_CWD && process.env.INIT_CWD === process.cwd();
const isGlobal      = !process.env.INIT_CWD || process.cwd().includes('node_modules');

if (isCI || isDocker || isLocalDev || !isGlobal) {
  process.exit(0);
}

// ── Global install only — set up PATH ────────────────────────────────────────
function getShellConfig() {
  const shell = process.env.SHELL || '';
  const home  = os.homedir();
  if (shell.includes('zsh'))  return path.join(home, '.zshrc');
  if (shell.includes('fish')) return path.join(home, '.config', 'fish', 'config.fish');
  const bp = path.join(home, '.bash_profile');
  return fs.existsSync(bp) ? bp : path.join(home, '.bashrc');
}

function detectNpmBin() {
  try {
    const { execFileSync } = require('child_process');
    const prefix = execFileSync('npm', ['config', 'get', 'prefix'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  } catch {
    return null;
  }
}

function ensureInPath(binPath) {
  const configFile = getShellConfig();
  const exportLine = `\n# AgentOS PATH\nexport PATH="${binPath}:$PATH"\n`;
  try {
    if (fs.existsSync(configFile)) {
      if (fs.readFileSync(configFile, 'utf8').includes('AgentOS PATH')) return;
    }
    fs.appendFileSync(configFile, exportLine);
    console.log(`[AgentOS] PATH configured in ${configFile}`);
    console.log(`[AgentOS] Run: source ${configFile}`);
  } catch {
    console.log(`[AgentOS] Could not write to ${configFile} — add ${binPath} to PATH manually`);
  }
}

try {
  const binPath = detectNpmBin();
  if (binPath && !(process.env.PATH || '').includes(binPath)) {
    ensureInPath(binPath);
  }
  console.log('[AgentOS] Installation complete. Run: agentos onboard');
} catch (_err) {
  // Never fail a global install due to PATH setup issues
}
