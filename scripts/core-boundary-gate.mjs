#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const coreRoot = path.resolve(root, 'src/core');
const forbidden = /(?:firebase-admin|routeros-client|routeros|mikrotik|starlink|whatsapp|telegram|mastercard|stripe|ecocash|voucher|hotspot|wifi|wireless|onvif|rtsp)/i;
const sourceExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
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
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (forbidden.test(specifier)) {
      findings.push(`${path.relative(root, file)} -> ${specifier}`);
    }
  }
}

if (findings.length) {
  console.error('Core boundary gate failed: domain/provider dependency found in src/core.');
  findings.forEach((finding) => console.error(`  - ${finding}`));
  process.exit(1);
}

console.log(`Core boundary gate passed: ${files.length} core source files scanned; no forbidden provider/domain imports found.`);
