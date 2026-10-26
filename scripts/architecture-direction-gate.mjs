#!/usr/bin/env node
/**
 * Directional architecture audit.
 *
 * Application/host surfaces must depend on ports and contracts, not import
 * provider-specific compatibility modules directly from src/core. Keep this
 * audit opt-in while legacy imports are being migrated; promote it to a
 * required CI gate only after the current violations are resolved.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['src/host', 'src/api', 'src/channels', 'src/cli'];
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const forbidden = [
  /(?:^|\/)src\/core\/(?:database|mikrotik|financial|firebase|onboard|universal-billing)\.(?:js|mjs|cjs|ts|tsx)$/i,
];
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (sourceExtensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const findings = [];
for (const sourceRoot of sourceRoots) {
  for (const file of walk(path.join(root, sourceRoot))) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(relative), specifier)).replaceAll(path.sep, '/');
      if (forbidden.some((rule) => rule.test(resolved))) findings.push(`${relative} -> ${specifier}`);
    }
  }
}

if (findings.length) {
  console.error('Architecture direction audit: FAIL — application code imports provider-specific core modules directly.');
  for (const finding of [...new Set(findings)]) console.error(`  - ${finding}`);
  console.error('Migrate these dependencies behind injected ports/adapters before making this a required CI gate.');
  process.exit(1);
}
console.log('Architecture direction audit: PASS — no direct imports of the listed core provider modules.');
