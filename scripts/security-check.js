#!/usr/bin/env node
'use strict';

/**
 * Fail-closed repository security checks.
 * Scans source/config files recursively without shell interpolation, then runs
 * the locally installed ESLint binary. Scanner errors are never reported as a pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const log = (...args) => console.log(...args);
const warn = (...args) => console.warn('⚠️', ...args);
let issues = 0;
let scanErrors = 0;
const root = process.cwd();
const ignoredDirectories = new Set([
  '.git', 'node_modules', '.security-review', 'coverage', 'dist', 'build',
  'platforms', 'www/lib', '.next', '.vercel',
]);
const ignoredFiles = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']);
const maxFileBytes = 1_000_000;
const secretPatterns = [
  { name: 'Private key', rx: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'AWS access key', rx: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', rx: /\bgh[pousr]_[A-Za-z0-9_]{20,255}\b/ },
  { name: 'Firebase service-account JSON', rx: /"type"\s*:\s*"service_account"/ },
  { name: 'Credential assignment', rx: /\b(?:password|passwd|client_secret|api_key|access_token)\s*[:=]\s*["']?(?!\$\{|\$[A-Z_]+|<|CHANGE_ME|YOUR_|EXAMPLE)[A-Za-z0-9_\-/+=]{16,}/i },
];
const textExtensions = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yml', '.yaml',
  '.toml', '.ini', '.conf', '.config', '.html', '.htm', '.css', '.md',
  '.sh', '.bash', '.ps1', '.sql', '.env', '.properties', '.xml',
]);

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) walk(full);
      continue;
    }
    if (!entry.isFile() || ignoredFiles.has(entry.name)) continue;
    if (entry.name === '.env.example' || entry.name === '.env.sample') continue;
    if (!textExtensions.has(path.extname(entry.name).toLowerCase()) && !entry.name.startsWith('.env')) continue;
    let stat;
    try { stat = fs.statSync(full); } catch (error) {
      scanErrors++;
      warn(`Could not stat ${relative}: ${error.message}`);
      continue;
    }
    if (stat.size > maxFileBytes) continue;
    let content;
    try { content = fs.readFileSync(full, 'utf8'); } catch (error) {
      scanErrors++;
      warn(`Could not read ${relative}: ${error.message}`);
      continue;
    }
    for (const pattern of secretPatterns) {
      if (pattern.rx.test(content)) {
        warn(`Possible ${pattern.name} in ${relative}`);
        issues++;
      }
    }
  }
}

log('🔐 Scanning repository text/config files for likely secrets...');
try {
  walk(root);
} catch (error) {
  scanErrors++;
  warn(`Secret scan could not complete: ${error.message}`);
}
if (scanErrors > 0) {
  console.error(`❌ Secret scan incomplete: ${scanErrors} read/walk error(s)`);
  process.exitCode = 1;
} else if (issues === 0) {
  log('✓ No known secret patterns detected');
}

log('\n🔍 Running ESLint (failure is blocking)...');
const eslintBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint');
if (!fs.existsSync(eslintBin)) {
  console.error('❌ Local ESLint binary is missing; install locked dependencies before running security checks.');
  process.exitCode = 1;
} else {
  const lint = spawnSync(eslintBin, ['.', '--max-warnings', '0'], { stdio: 'inherit', shell: false });
  if (lint.error) {
    console.error(`❌ ESLint could not run: ${lint.error.message}`);
    process.exitCode = 1;
  } else if (lint.status !== 0) {
    console.error(`❌ ESLint failed with exit code ${lint.status ?? 'unknown'}`);
    process.exitCode = 1;
  } else {
    log('✓ ESLint passed');
  }
}

log('\n' + '─'.repeat(50));
if (issues > 0) {
  console.error(`❌ Found ${issues} potential secret(s); review and rotate any real credentials.`);
  process.exitCode = 1;
}
if (process.exitCode === 1) {
  console.error('❌ Security checks failed or did not complete.');
} else {
  log('✅ Security checks passed. This is not a substitute for dependency or runtime vulnerability scanning.');
}
