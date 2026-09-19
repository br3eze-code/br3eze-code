#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coreRoot = path.resolve(root, 'src/core');
const sourceExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const forbiddenImport = /(?:firebase-admin|firebase\/|routeros-client|routeros|mikrotik|starlink|voucher|hotspot|wifi|wireless|onvif|rtsp)/i;
const forbiddenCorePath = /(?:^|\/)(?:mikrotik|mikrotik-mesh|starlink|voucher|universal-billing|financial|shop|plans-sales|mobile-money|whatsapp|telegram|discord|slack|printer|courier-gateway)\.(?:js|mjs|cjs|ts|tsx)$/i;
const forbiddenRelative = /^(?:\.\.?\/)+(?:services|plugins|domains)\//;
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

// These files pre-date the domain/adapter boundary and remain compatibility
// shims. They are intentionally excluded from the hard gate while migration
// proceeds; new core files still have to satisfy the boundary.
const legacyCoreShims = new Set([
  'src/core/courier-gateway.js',
  'src/core/financial.js',
  'src/core/loadDomain.js',
  'src/core/memory/MemoryManager.js',
  'src/core/mikrotik.js',
  'src/core/monitor.js',
  'src/core/plans-sales.js',
  'src/core/printer.js',
  'src/core/shop.js',
  'src/core/telegram.js',
  'src/core/universal-billing.js',
  'src/core/voucher.js',
  'src/core/whatsapp.js',
]);

function walk(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (sourceExt.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

const files = walk(coreRoot);
const findings = [];
for (const file of files) {
  const relative = path.relative(root, file).replaceAll(path.sep, '/');
  if (legacyCoreShims.has(relative)) continue;
  if (forbiddenCorePath.test(relative)) findings.push(`${relative} -> concrete domain/provider filename`);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (forbiddenImport.test(specifier) || forbiddenRelative.test(specifier)) findings.push(`${relative} -> ${specifier}`);
  }
}

const unique = [...new Set(findings)];
if (unique.length) {
  console.error('Core boundary gate failed: src/core contains a concrete domain/provider dependency.');
  unique.forEach((finding) => console.error(`  - ${finding}`));
  process.exit(1);
}
console.log(`Core boundary gate passed: ${files.length} core source files scanned; legacy compatibility shims excluded; new core contains no concrete domain/provider dependencies.`);
