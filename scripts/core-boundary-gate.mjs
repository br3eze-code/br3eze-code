#!/usr/bin/env node
/**
 * Enforces the AgentOS core boundary.
 * The canonical kernel/runtime graph may depend on core contracts only; concrete
 * domains, vendors, channels, payment systems and persistence providers belong
 * behind injected adapters.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
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
// The generic server transport core is a separate boundary: it may use
// injected framework capabilities, but must not import product domains,
// persistence, identity providers, payments, or network-vendor implementations.
const serverCoreRoot = path.resolve(root, 'server/src/core');
const serverFindings = [];
if (fs.existsSync(serverCoreRoot)) {
  const pending = [serverCoreRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      if (!entry.isFile() || !/\\.(?:mjs|cjs|js)$/.test(entry.name)) continue;
      const source = fs.readFileSync(absolute, 'utf8');
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        if (forbidden.test(specifier)) {
          serverFindings.push(`server core forbidden dependency: ${path.relative(root, absolute)} -> ${specifier}`);
        }
        const resolved = resolveImport(absolute, specifier);
        if (specifier.startsWith('.') && resolved && !resolved.startsWith(serverCoreRoot + path.sep)) {
          serverFindings.push(`server core import escapes its boundary: ${path.relative(root, absolute)} -> ${specifier}`);
        }
      }
    }
  }
}
findings.push(...serverFindings);

if (findings.length) {
  console.error('Core boundary gate failed: concrete domain/provider dependency reached the canonical kernel graph.');
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log(`Core boundary gate passed: ${visited.size} canonical AgentOS core modules and generic server-core imports scanned.`);
