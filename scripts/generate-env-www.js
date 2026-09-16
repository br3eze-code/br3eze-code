#!/usr/bin/env node
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Generates www/js/env.js from the repo-root .env file.
 * Only browser-safe credentials are copied to the Cordova/web bundle.
 */
'use strict';

import fs from 'fs';

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT_PATH = path.join(ROOT, 'www', 'js', 'env.js');

const BROWSER_KEYS = [
    'FIREBASE_API_KEY',
    'GEMINI_API_KEY',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_OAUTH_REDIRECT'
];

if (!fs.existsSync(ENV_PATH)) {
    console.error(`[env:www] ${ENV_PATH} not found — cannot generate www/js/env.js`);
    process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    env[m[1]] = value;
}

const required = ['FIREBASE_API_KEY', 'GEMINI_API_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter((k) => !env[k]);
if (missing.length) {
    console.error(`[env:www] Missing in .env: ${missing.join(', ')}`);
    process.exit(1);
}

const body = BROWSER_KEYS
    .filter((k) => env[k])
    .map((k) => `    ${k}: ${JSON.stringify(env[k])}`)
    .join(',\n');
const out = `// AUTO-GENERATED from .env by scripts/generate-env-www.js — do not edit.\nwindow.ENV = {\n${body}\n};\n`;
fs.writeFileSync(OUT_PATH, out, 'utf8');
console.log(`[env:www] Wrote ${path.relative(ROOT, OUT_PATH)} (${BROWSER_KEYS.filter((k) => env[k]).join(', ')})`);
