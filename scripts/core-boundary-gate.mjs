#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const roots = ['src/core/agentKernel.js','src/core/agentRuntime.js','src/core/agent-runtime/index.js','src/core/taskRegistry.js','src/core/tool-registry.js','src/core/capability-boundary.js','src/core/saas-boundary.js','src/core/node-registry.js','src/core/orchestrator.js','src/core/SkillRegistry.js','src/core/onboarding-wbs.js','src/core/model-router.js','src/core/provider-manager.js','src/core/print-broker.js'];
const forbidden = /(?:firebase-admin|routeros-client|routeros|mikrotik|starlink|whatsapp|telegram|mastercard|stripe|ecocash|voucher|hotspot|wifi|wireless|printer)/i;
const importPattern = /(?:import\s+(?:[^'";]+?\s+from\s+)?|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g;
function resolveImport(from, specifier) { if (!specifier.startsWith('.')) return null; const candidate = path.resolve(path.dirname(from), specifier); for (const file of [candidate,`${candidate}.js`,`${candidate}.mjs`,`${candidate}.cjs`,path.join(candidate,'index.js')]) if (fs.existsSync(file) && fs.statSync(file).isFile()) return file; return null; }
const visited = new Set(); const findings = [];
function walk(file) { if (visited.has(file) || !fs.existsSync(file)) return; visited.add(file); const text = fs.readFileSync(file,'utf8'); for (const match of text.matchAll(importPattern)) { const specifier=match[1]; if (forbidden.test(specifier)) findings.push(`${path.relative(root,file)} -> ${specifier}`); const resolved=resolveImport(file,specifier); if (resolved?.includes(`${path.sep}src${path.sep}core${path.sep}`)) walk(resolved); } }
for (const entry of roots) walk(path.resolve(root,entry));
if (findings.length) { console.error('Core boundary gate failed: concrete domain/provider dependency reached the canonical kernel graph.'); findings.forEach(f=>console.error(`  - ${f}`)); process.exit(1); }
console.log(`Core boundary gate passed: ${visited.size} canonical core modules scanned.`);
