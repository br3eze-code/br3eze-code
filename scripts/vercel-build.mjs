#!/usr/bin/env node
/**
 * Build the deployable static web surface from www/ without publishing PHP
 * source files or server configuration. The source tree remains the canonical
 * Cordova/PHP-compatible app; Vercel receives a separate generated artifact.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'www');
const output = path.join(root, 'dist-web');

if (!fs.existsSync(path.join(source, 'home.html'))) {
  throw new Error('Missing www/home.html; cannot build public website.');
}
if (!fs.existsSync(path.join(root, 'api', 'index.js'))) {
  throw new Error('Missing api/index.js; cannot build API deployment.');
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

const excludedNames = new Set(['.htaccess', '.htpasswd', '.user.ini']);
const excludedExtensions = new Set(['.php', '.phtml', '.phar']);

function copyStaticTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (excludedNames.has(entry.name) || entry.name.startsWith('.')) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyStaticTree(src, dest);
      continue;
    }
    if (!entry.isFile() || excludedExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    fs.copyFileSync(src, dest);
  }
}

copyStaticTree(source, output);

// The source index is the legacy captive-portal shell. Keep it available under
// an explicit path, but make the public website homepage the deployment root.
fs.copyFileSync(path.join(source, 'index.html'), path.join(output, 'connect.html'));
fs.copyFileSync(path.join(source, 'home.html'), path.join(output, 'index.html'));

// Browser configuration is generated at build time from public-only values.
// Server secrets (service-role/secret keys, JWT secrets, database credentials,
// model keys) are intentionally never read or emitted by this build.
const publicEnv = {
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY || '',
  SUPABASE_OAUTH_REDIRECT: process.env.SUPABASE_OAUTH_REDIRECT || '',
  API_BASE_URL: process.env.AGENTOS_API_BASE_URL || process.env.VITE_API_URL || '',
  AGENTOS_API_BASE_URL: process.env.AGENTOS_API_BASE_URL || process.env.VITE_API_URL || '',
  OFFLINE_FIRST: true,
};
const envPath = path.join(output, 'js', 'env.js');
fs.mkdirSync(path.dirname(envPath), { recursive: true });
fs.writeFileSync(
  envPath,
  `// Generated during deployment. Contains browser-safe configuration only.\nwindow.ENV = Object.freeze(${JSON.stringify(publicEnv, null, 2)});\n`,
  'utf8',
);

// Never publish private PHP source or accidentally generated env files.
const leaked = [];
function scanForPrivateFiles(dir, relative = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) scanForPrivateFiles(path.join(dir, entry.name), rel);
    else if (excludedExtensions.has(path.extname(entry.name).toLowerCase()) || excludedNames.has(entry.name)) leaked.push(rel);
  }
}
scanForPrivateFiles(output);
if (leaked.length) throw new Error(`Private/server-only files reached web output: ${leaked.join(', ')}`);

console.log(`[vercel:build] Static website prepared at dist-web (${publicEnv.SUPABASE_URL ? 'Supabase URL configured' : 'Supabase URL not configured'}, ${publicEnv.SUPABASE_PUBLISHABLE_KEY ? 'publishable key configured' : 'publishable key not configured'}).`);
