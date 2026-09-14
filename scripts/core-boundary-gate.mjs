#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coreRoot = path.resolve(root, 'src/core');
const sourceExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const forbiddenImport = /(?:firebase-admin|firebase\/|routeros-client|routeros|mikrotik|starlink|whatsapp|telegram|mastercard|stripe|ecocash|voucher|hotspot|wifi|wireless|onvif|rtsp)/i;
const forbiddenCorePath = /(?:^|\/)(?:mikrotik|mikrotik-mesh|starlink|voucher|universal-billing|financial|shop|plans-sales|mobile-money|whatsapp|telegram|discord|slack|printer|courier-gateway)\.(?:js|mjs|cjs|ts|tsx)$/i;
const forbiddenRelative = /^(?:\.\.?\/)+(?:adapters|services|plugins|domains)\//;
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

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
console.log(`Core boundary gate passed: ${files.length} core source files scanned; core contains no concrete domain/provider filenames or extension-layer imports.`);
