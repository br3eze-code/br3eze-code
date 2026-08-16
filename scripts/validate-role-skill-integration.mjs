import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('skills');
const packages = [
  'agentos-specialist-swarm',
  'agentos-project-manager',
  'agentos-planner',
  'agentos-engineer',
  'agentos-accountant',
  'agentos-secretary',
  'agentos-procurement',
  'agentos-expeditor',
  'agentos-designer',
  'agentos-draftsman',
  'agentos-qa',
  'agentos-editor'
];

for (const packageName of packages) {
  const dir = path.join(root, packageName);
  const skill = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
  if (!/^---\nname:\s*agentos-/m.test(skill) || !/^description:\s*.+/m.test(skill)) {
    throw new Error(`${packageName}: invalid skill frontmatter`);
  }
  const module = await import(`../skills/${packageName}/index.js`);
  if (!module.specialist || typeof module.createContext !== 'function') {
    throw new Error(`${packageName}: missing specialist exports`);
  }
  const context = module.createContext({ userId: 'test-user', tenantId: 'test-tenant' });
  if (context.agentRole !== module.role || context.tenantId !== 'test-tenant') {
    throw new Error(`${packageName}: context identity or tenant propagation failed`);
  }
  let rejected = false;
  try { module.createContext({ tenantId: 'test-tenant' }); } catch { rejected = true; }
  if (!rejected) throw new Error(`${packageName}: missing userId was not rejected`);
}

const pm = await import('../skills/agentos-project-manager/index.js');
const qa = await import('../skills/agentos-qa/index.js');
if (!pm.specialist.approvalRequired.includes('budget.commit')) throw new Error('Project Manager budget approval missing');
if (!qa.specialist.approvalRequired.includes('qa.accept')) throw new Error('QA acceptance approval missing');

console.log(`Validated ${packages.length} role-skill packages, including Project Manager and QA integration.`);
