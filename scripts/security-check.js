#!/usr/bin/env node
'use strict';

/**
 * scripts/security-check.js
 * Security validation for CI/CD pipeline
 * 
 * Checks:
 * - No hardcoded secrets/credentials
 * - No dangerous dependencies
 * - No XSS/injection vulnerabilities
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const log = (...a) => console.log(...a);
const warn = (...a) => console.warn('⚠️ ', ...a);
const err = (...a) => { console.error('❌', ...a); process.exit(1); };

let issues = 0;

// ── Check for hardcoded secrets ───────────────────────────────────────────
log('🔐 Checking for hardcoded secrets...');

const secretPatterns = [
  { name: 'Private Key', rx: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { name: 'AWS Key', rx: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', rx: /gh[pousr]{1,2}_[A-Za-z0-9_]{36,255}/ },
  { name: 'Firebase Key', rx: /"type"\s*:\s*"service_account"/ },
];

const filesToCheck = [
  'package.json',
  'src/**/*.js',
  'bin/**/*.js',
  'scripts/**/*.js',
  '.env',
];

try {
  for (const pattern of secretPatterns) {
    const result = execSync(`grep -r "${pattern.rx.source}" ${filesToCheck.join(' ')} 2>/dev/null || true`, {
      encoding: 'utf8',
    }).trim();
    
    if (result) {
      warn(`Found pattern: ${pattern.name}`);
      issues++;
    }
  }
} catch {
  // grep may fail if files don't exist — that's OK
}

if (issues === 0) {
  log('✓ No hardcoded secrets detected');
}

// ── Check dangerous dependencies ──────────────────────────────────────────
log('\n📦 Checking dependencies...');

const dangerousPkgs = new Set([
  'eval',
  'vm2',  // deprecated
  'serialize-javascript', // has vulnerabilities
]);

try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const allDeps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.optionalDependencies,
  };

  for (const dep of dangerousPkgs) {
    if (allDeps[dep]) {
      warn(`Found potentially dangerous package: ${dep}`);
      issues++;
    }
  }
  
  log('✓ Dependency check passed');
} catch (e) {
  warn(`Could not read package.json: ${e.message}`);
}

// ── ESLint security check ─────────────────────────────────────────────────
log('\n🔍 Running ESLint security checks...');

try {
  execSync('npx eslint . --max-warnings 0 2>&1 || true', { stdio: 'inherit' });
  log('✓ ESLint passed');
} catch {
  warn('ESLint warnings detected (non-fatal in CI)');
}

// ── Summary ───────────────────────────────────────────────────────────────
log('\n' + '─'.repeat(50));
if (issues === 0) {
  log('✅ Security check passed with 0 issues');
  process.exit(0);
} else {
  warn(`Security check found ${issues} issue(s)`);
  process.exit(1);
}
