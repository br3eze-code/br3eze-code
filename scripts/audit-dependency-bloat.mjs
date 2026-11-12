#!/usr/bin/env node
/**
 * Heuristic dependency inventory. This deliberately reports candidates only:
 * dynamic imports, plugin manifests, generated code and runtime configuration
 * can make a dependency appear unused even when it is required.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ignoredDirs = new Set([
  '.git', 'node_modules', 'coverage', 'dist', 'build', 'release',
  '.next', '.vercel', '.claude', 'vendor', 'platforms'
]);
const scannedExtensions = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yml',
  '.yaml', '.xml', '.html', '.sh', '.ps1', '.php', '.properties'
]);
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'package-lock.json' || entry.name === 'npm-shrinkwrap.json') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) walk(full);
    } else if (
      entry.isFile() &&
      path.relative(root, full).split(path.sep).join('/') !== 'package.json' &&
      scannedExtensions.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(full);
    }
  }
}

walk(root);
const contents = files.map(file => ({
  path: path.relative(root, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8')
}));
const declared = {
  ...Object.fromEntries(Object.entries(packageJson.dependencies ?? {}).map(([name, version]) => [name, { version, group: 'dependencies' }])),
  ...Object.fromEntries(Object.entries(packageJson.devDependencies ?? {}).map(([name, version]) => [name, { version, group: 'devDependencies' }])),
  ...Object.fromEntries(Object.entries(packageJson.optionalDependencies ?? {}).map(([name, version]) => [name, { version, group: 'optionalDependencies' }]))
};
const candidates = [];
for (const [name, meta] of Object.entries(declared)) {
  const hits = contents.filter(file => file.text.includes(name)).map(file => file.path);
  if (hits.length === 0) candidates.push({
    name, version: meta.version, group: meta.group,
    status: 'manual-review-only',
    reason: 'No literal reference found in scanned files; dynamic/plugin/config use may be missed.'
  });
}
const report = {
  generatedAt: new Date().toISOString(),
  mode: 'heuristic; no dependencies removed',
  filesScanned: contents.length,
  declaredDependencies: Object.keys(declared).length,
  candidateCount: candidates.length,
  candidates
};
const outputArg = process.argv.find(arg => arg.startsWith('--output='));
if (outputArg) fs.writeFileSync(path.resolve(root, outputArg.slice('--output='.length)), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
