#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourceRoots = ['src/host', 'src/api', 'src/channels', 'src/cli'];
const sourceExt = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const forbidden = [
  /(?:^|\/)src\/core\/(?:database|mikrotik|financial|firebase|onboard|universal-billing)\.(?:js|mjs|cjs|ts|tsx)$/i,
];
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (sourceExt.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const findings = [];
for (const sourceRoot of sourceRoots) {
  for (const file of walk(path.join(root, sourceRoot))) {
    const relative = path.relative(root, file).replaceAll(path.sep, '/');
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(relative), specifier)).replaceAll(path.sep, '/');
      if (forbidden.some((rule) => rule.test(resolved))) findings.push(`${relative} -> ${specifier}`);
    }
  }
}

if (findings.length) {
  console.error('Architecture direction gate failed: host/application code bypasses provider ports.');
  for (const finding of [...new Set(findings)]) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log('Architecture direction gate passed: host/application surfaces do not import Core provider compatibility modules.');
