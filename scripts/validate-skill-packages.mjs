#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const packageDirs = [
  { label: 'skills', dir: path.join(root, 'skills'), requireContract: true },
  { label: 'Claude plugin skills', dir: path.join(root, 'plugins', 'agentos', 'skills'), requireContract: false },
];
let total = 0;
const allNames = new Map();

function checkSkill(label, dir, requireContract) {
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) {
    failures.push(`${label}: missing SKILL.md`);
    return;
  }
  const content = fs.readFileSync(file, 'utf8');
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (!fm) {
    failures.push(`${label}: YAML frontmatter is required`);
    return;
  }
  const name = fm[1].match(/^name:\s*([^\n#]+)\s*$/m)?.[1]?.trim();
  const description = fm[1].match(/^description:\s*(.+)\s*$/m)?.[1]?.trim();
  const expected = path.basename(path.dirname(file));
  if (!name) failures.push(`${label}: name is required`);
  if (!description || description.length < 20) failures.push(`${label}: useful description (at least 20 characters) is required`);
  if (name && name !== expected) failures.push(`${label}: name "${name}" must match directory "${expected}"`);
  if (name && allNames.has(name)) failures.push(`${label}: duplicate skill name "${name}" (also ${allNames.get(name)})`);
  else if (name) allNames.set(name, label);
  if (requireContract && !content.includes('## Cross-agent delivery contract')) failures.push(`${label}: missing Cross-agent delivery contract`);
  if (requireContract && !/src\/core\/agentRuntime\.js/.test(content)) failures.push(`${label}: must identify the canonical AgentRuntime owner`);
  total++;
}

for (const pkg of packageDirs) {
  if (!fs.existsSync(pkg.dir)) {
    failures.push(`${pkg.label}: directory missing`);
    continue;
  }
  const entries = fs.readdirSync(pkg.dir, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (!entries.length) failures.push(`${pkg.label}: no skill packages found`);
  for (const entry of entries) checkSkill(`${pkg.label}/${entry.name}`, path.join(pkg.dir, entry.name), pkg.requireContract);
}

if (failures.length) {
  console.error(`Skill package validation failed (${failures.length} issue(s), ${total} package(s) scanned):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Skill package validation passed (${total} packages scanned).`);
}
