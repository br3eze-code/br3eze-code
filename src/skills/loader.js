import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

/**
 * Read SKILL.md / skill.yaml manifests from trusted directories.
 * This parses metadata only; it never executes community-provided code.
 * Execution isolation must be supplied by a configured sandbox adapter.
 */
export async function loadSkillManifests(root, { maxFiles = 500, maxBytes = 256 * 1024 } = {}) {
  if (!root) throw new TypeError('A skills root directory is required');
  const base = path.resolve(root);
  const queue = [base];
  const manifests = [];
  let visited = 0;
  while (queue.length && visited < maxFiles) {
    const current = queue.shift();
    let entries;
    try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++visited > maxFiles) break;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.resolve(current, entry.name);
      if (!full.startsWith(base + path.sep) && full !== base) continue;
      if (entry.isDirectory()) { queue.push(full); continue; }
      if (!entry.isFile() || !['SKILL.md', 'skill.yaml', 'skill.yml'].includes(entry.name)) continue;
      const stat = await fs.stat(full);
      if (stat.size > maxBytes) continue;
      const source = await fs.readFile(full, 'utf8');
      let manifest;
      if (/\.ya?ml$/i.test(entry.name)) {
        manifest = yaml.load(source, { schema: yaml.JSON_SCHEMA });
      } else {
        const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
        if (!match) continue;
        manifest = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
        if (manifest && typeof manifest === 'object') manifest.instructions = source.slice(match[0].length).trim();
      }
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) continue;
      if (typeof manifest.name !== 'string' || !manifest.name.trim()) continue;
      manifests.push({ ...manifest, sourcePath: full, trusted: false, executionMode: 'sandbox-required' });
    }
  }
  return manifests;
}
export default loadSkillManifests;
