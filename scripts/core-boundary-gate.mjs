#!/usr/bin/env node
<<<<<<< HEAD
/**
 * Enforces the AgentOS core boundary.
 * The canonical kernel/runtime graph may depend on core contracts only; concrete
 * domains, vendors, channels, payment systems and persistence providers belong
 * behind injected adapters.
 */
=======
>>>>>>> origin/main
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
<<<<<<< HEAD
const roots = [
  'src/core/agentKernel.js', 'src/core/agentRuntime.js',
  'src/core/agent-runtime/index.js', 'src/core/taskRegistry.js',
  'src/core/tool-registry.js', 'src/core/capability-boundary.js',
  'src/core/saas-boundary.js', 'src/core/node-registry.js',
  'src/core/orchestrator.js', 'src/core/SkillRegistry.js',
  'src/core/onboarding-wbs.js', 'src/core/model-router.js',
  'src/core/provider-manager.js', 'src/core/print-broker.js'
];
const forbidden = /(?:firebase-admin|firebase\/|routeros-client|mikrotik|routeros|starlink|whatsapp|telegram|mastercard|stripe|ecocash|voucher|hotspot|wifi|wireless|printer)/i;
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  let candidate = path.resolve(path.dirname(from), specifier);
  for (const file of [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.cjs`, path.join(candidate, 'index.js')]) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

const visited = new Set();
const findings = [];
function walk(file) {
  if (visited.has(file) || !fs.existsSync(file)) return;
  visited.add(file);
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (forbidden.test(specifier)) findings.push(`${path.relative(root, file)} -> ${specifier}`);
    const resolved = resolveImport(file, specifier);
    if (resolved && resolved.includes(`${path.sep}src${path.sep}core${path.sep}`)) walk(resolved);
  }
}

for (const entry of roots) walk(path.resolve(root, entry));
if (findings.length) {
  console.error('Core boundary gate failed: concrete domain/provider dependency reached the canonical kernel graph.');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(`Core boundary gate passed: ${visited.size} canonical core modules scanned.`);
=======
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
>>>>>>> origin/main
