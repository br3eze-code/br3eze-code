#!/usr/bin/env node
/**
 * Generates www/js/env.js from the repo-root .env file.
 *
 * www/js/env.js is a build artifact (gitignored) — it is the bridge that
 * exposes browser-safe keys to the static www/ app, which has no bundler.
 * Only the keys listed in BROWSER_KEYS are copied; everything else in .env
 * (bot tokens, payment secrets, router passwords, ...) must never reach the
 * client, so additions here need to be deliberate.
 *
 * Runs automatically before `firebase deploy` (see firebase.json hosting
 * predeploy). Run manually after changing .env: `npm run env:www`
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const OUT_PATH = path.join(ROOT, 'www', 'js', 'env.js');

// Required: the app can't boot without these. Optional: features degrade
// gracefully client-side when absent (e.g. Payments.ensureStripe() checks
// for STRIPE_PUBLISHABLE_KEY and shows a toast instead of crashing), so a
// secret ops hasn't provisioned yet must not fail the hosting predeploy.
const REQUIRED_KEYS = ['FIREBASE_API_KEY', 'GEMINI_API_KEY'];
const OPTIONAL_KEYS = ['STRIPE_PUBLISHABLE_KEY'];
const BROWSER_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

if (!fs.existsSync(ENV_PATH)) {
    console.error(`[env:www] ${ENV_PATH} not found — cannot generate www/js/env.js`);
    process.exit(1);
}

const env = {};
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let value = m[2];
    // Strip surrounding quotes and trailing inline comments on unquoted values.
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    env[m[1]] = value;
}

const missingRequired = REQUIRED_KEYS.filter((k) => !env[k]);
if (missingRequired.length) {
    console.error(`[env:www] Missing in .env: ${missingRequired.join(', ')}`);
    process.exit(1);
}
const missingOptional = OPTIONAL_KEYS.filter((k) => !env[k]);
if (missingOptional.length) {
    console.warn(`[env:www] Optional keys not set (features will degrade gracefully): ${missingOptional.join(', ')}`);
}

const present = BROWSER_KEYS.filter((k) => env[k]);
const body = present.map((k) => `    ${k}: ${JSON.stringify(env[k])}`).join(',\n');
const out = `// AUTO-GENERATED from .env by scripts/generate-env-www.js — do not edit.
// Regenerate with: npm run env:www
window.ENV = {
${body}
};
`;

fs.writeFileSync(OUT_PATH, out, 'utf8');
console.log(`[env:www] Wrote ${path.relative(ROOT, OUT_PATH)} (${present.join(', ')})`);
