import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kernelRoots = [
  'src/core/capability-boundary.js',
  'src/core/saas-boundary.js',
  'src/core/taskRegistry.js',
  'src/core/tool-registry.js',
  'src/core/skills/SkillRegistry.js',
  'src/core/onboarding-wbs.js',
  'src/core/model-router.js',
  'src/core/agentos-bootstrap.js',
  'src/core/node-registry.js',
];
const forbiddenImport = /(?:mikrotik|starlink|voucher|mastercard|telegram|whatsapp|wifi)/i;
const failures = [];
for (const relative of kernelRoots) {
  const source = await readFile(path.join(root, relative), 'utf8');
  const imports = source.split('\n').filter((line) => /^\s*import\b/.test(line));
  for (const line of imports) if (forbiddenImport.test(line)) failures.push(`${relative}: ${line.trim()}`);
}

const required = [
  ['src/core/saas-boundary.js', 'createTenantContext'],
  ['src/core/capability-boundary.js', 'checkCapabilityBoundary'],
  ['src/core/taskRegistry.js', 'authenticated tenant context required'],
  ['src/core/tool-registry.js', 'CapabilityBoundaryError'],
];
for (const [relative, token] of required) {
  const source = await readFile(path.join(root, relative), 'utf8');
  if (!source.includes(token)) failures.push(`${relative}: missing required gate ${token}`);
}

if (failures.length) {
  console.error('ARCHITECTURE GATE: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`ARCHITECTURE GATE: PASS — ${kernelRoots.length}/${kernelRoots.length} kernel boundaries isolated (100%)`);
