#!/usr/bin/env node
/**
 * Enforces two repository invariants:
 * 1. Source and package manifests must not contain unresolved merge markers.
 * 2. The canonical core execution graph must not import concrete domain/vendor
 *    implementations directly; those belong behind registered adapters.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const conflictRoots = ['src', 'scripts'];
const conflictFiles = ['package.json', 'package-lock.json'];
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.yml', '.yaml', '.php', '.html', '.css']);
const markerPattern = /^(<<<<<<<(?: .*)?|=======(?: .*)?|>>>>>>>(?: .*)?)$/m;
const conflictFindings = [];

function collectFiles(entry) {
  const absolute = path.resolve(root, entry);
  if (!fs.existsSync(absolute)) return [];
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return sourceExtensions.has(path.extname(absolute)) ? [absolute] : [];
  const found = [];
  for (const name of fs.readdirSync(absolute)) {
    if (['node_modules', '.git', 'dist', 'coverage', 'platforms', 'release', 'vendor'].includes(name)) continue;
    found.push(...collectFiles(path.join(absolute, name)));
  }
  return found;
}

const scanFiles = [...new Set([
  ...conflictRoots.flatMap(collectFiles),
  ...conflictFiles.map((file) => path.resolve(root, file)).filter((file) => fs.existsSync(file)),
])];
for (const file of scanFiles) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/^(<<<<<<<(?: .*)?|=======(?: .*)?|>>>>>>>(?: .*)?)$/.test(line.trim())) {
      conflictFindings.push(`${path.relative(root, file)}:${index + 1}: unresolved merge marker`);
    }
  });
}
if (conflictFindings.length) {
  console.error('Repository integrity gate failed: unresolved merge markers found:');
  for (const finding of conflictFindings) console.error(`  - ${finding}`);
  process.exitCode = 1;
}

const roots = [
  'src/core/agentKernel.js',
  'src/core/agentRuntime.js',
  'src/core/agent-runtime/index.js',
  'src/core/taskRegistry.js',
  'src/core/tool-registry.js',
  'src/core/capability-boundary.js',
  'src/core/saas-boundary.js',
  'src/core/node-registry.js',
  'src/core/orchestrator.js',
  'src/core/SkillRegistry.js',
  'src/core/onboarding-wbs.js',
  'src/core/model-router.js',
  'src/core/provider-manager.js',
  'src/core/print-broker.js',
];
const forbidden = /(?:^|[/@-])(?:firebase-admin|routeros-client|mikrotik|starlink|whatsapp|telegram|mastercard|stripe|ecocash|voucher|hotspot|wifi|wireless|printer)(?:$|[/@.-])/i;
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;

function resolveImport(from, specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = path.resolve(path.dirname(from), specifier);
  for (const file of [candidate, `${candidate}.js`, `${candidate}.mjs`, `${candidate}.cjs`, `${candidate}.ts`, path.join(candidate, 'index.js')]) {
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

const visited = new Set();
const boundaryFindings = [];
function walk(file) {
  if (visited.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return;
  visited.add(file);
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (forbidden.test(specifier)) boundaryFindings.push(`${path.relative(root, file)} -> ${specifier}`);
    const resolved = resolveImport(file, specifier);
    if (resolved && resolved.includes(`${path.sep}src${path.sep}core${path.sep}`)) walk(resolved);
  }
}
for (const entry of roots) walk(path.resolve(root, entry));

if (boundaryFindings.length) {
  console.error('Core boundary gate failed: concrete domain/provider dependencies found in the core graph:');
  for (const finding of boundaryFindings) console.error(`  - ${finding}`);
  process.exitCode = 1;
}
if (conflictFindings.length === 0 && boundaryFindings.length === 0) {
  console.log('Core boundary and repository-integrity gates passed.');
}
