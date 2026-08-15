import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const excluded = new Set(['.git', 'node_modules', 'www/lib', 'platforms', 'dist', 'coverage']);
const roots = ['src', 'core', 'skills', 'plugins', 'services', 'scripts', 'main.js', 'bin'];
const files = [];

function walk(target) {
  const absolute = join(process.cwd(), target);
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    return;
  }
  if (stat.isFile()) {
    if (absolute.endsWith('.js') || absolute.endsWith('.mjs')) files.push(absolute);
    return;
  }
  for (const entry of readdirSync(absolute)) {
    if (excluded.has(entry)) continue;
    walk(join(target, entry));
  }
}

for (const root of roots) walk(root);
files.sort();
let failures = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    failures += 1;
    process.stderr.write(`Syntax error in ${relative(process.cwd(), file)}\n`);
    process.stderr.write(error.stderr?.toString() || `${error.message}\n`);
  }
}
if (failures) process.exit(1);
console.log(`Syntax check passed for ${files.length} JavaScript files.`);
