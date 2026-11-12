#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketplacePath = path.join(root, '.claude-plugin', 'marketplace.json');
const failures = [];
const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { failures.push(`${path.relative(root, file)}: invalid JSON or unreadable file (${error.message})`); return null; }
};

const marketplace = readJson(marketplacePath);
if (marketplace) {
  if (typeof marketplace.name !== 'string' || !marketplace.name.trim()) failures.push('marketplace.json: name is required');
  if (!marketplace.owner || typeof marketplace.owner.name !== 'string' || !marketplace.owner.name.trim()) failures.push('marketplace.json: owner.name is required');
  if (!Array.isArray(marketplace.plugins) || marketplace.plugins.length === 0) failures.push('marketplace.json: plugins must be a non-empty array');
  for (const entry of marketplace.plugins || []) {
    if (!entry.name || !entry.source || !entry.description) { failures.push('marketplace.json: every plugin entry requires name, source, and description'); continue; }
    if (entry.source.includes('..')) { failures.push(`marketplace.json: source path must not contain '..': ${entry.source}`); continue; }
    const pluginRoot = path.resolve(root, entry.source);
    if (!pluginRoot.startsWith(root + path.sep)) { failures.push(`marketplace.json: source escapes repository root: ${entry.source}`); continue; }
    const manifestPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
    const manifest = readJson(manifestPath);
    if (manifest && manifest.name !== entry.name) failures.push(`plugin name mismatch: marketplace ${entry.name}, manifest ${manifest.name}`);
    if (!manifest?.description) failures.push(`${path.relative(root, manifestPath)}: description is required`);
    const skillsRoot = path.join(pluginRoot, 'skills');
    if (!fs.existsSync(skillsRoot)) { failures.push(`${path.relative(root, skillsRoot)}: missing skills directory`); continue; }
    const dirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(item => item.isDirectory());
    if (!dirs.length) failures.push(`${path.relative(root, skillsRoot)}: at least one skill is required`);
    for (const dir of dirs) {
      const skillPath = path.join(skillsRoot, dir.name, 'SKILL.md');
      if (!fs.existsSync(skillPath)) { failures.push(`${path.relative(root, skillPath)}: missing SKILL.md`); continue; }
      const content = fs.readFileSync(skillPath, 'utf8');
      const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      if (!frontmatter) { failures.push(`${path.relative(root, skillPath)}: YAML frontmatter is required`); continue; }
      const name = frontmatter[1].match(/^name:\s*([^\n#]+)\s*$/m)?.[1]?.trim();
      const description = frontmatter[1].match(/^description:\s*(.+)\s*$/m)?.[1]?.trim();
      if (!name) failures.push(`${path.relative(root, skillPath)}: name is required`);
      if (!description) failures.push(`${path.relative(root, skillPath)}: description is required`);
      if (name && name !== dir.name) failures.push(`${path.relative(root, skillPath)}: frontmatter name "${name}" must match directory "${dir.name}"`);
    }
  }
}

if (failures.length) {
  console.error('Claude Code plugin validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Claude Code plugin validation passed.');
}
