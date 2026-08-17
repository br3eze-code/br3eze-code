#!/usr/bin/env node
/**
 * CI gate for regressions that are easy to introduce during branch merges.
 *
 * The repository currently has legacy lint debt, so this gate deliberately
 * evaluates only changed JS/TS files. Existing warnings remain visible, while
 * any new ESLint error or duplicate export fails CI.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const base = process.env.CI_BASE_SHA || process.env.GITHUB_BASE_SHA || 'origin/main';
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function changedFiles() {
  const output = git(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]);
  return output
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => sourceExtensions.has(path.extname(file)))
    .filter((file) => fs.existsSync(path.join(root, file)));
}

function duplicateExports(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const names = new Map();
  const add = (name, line) => {
    if (!name) return;
    const previous = names.get(name);
    if (previous) previous.push(line);
    else names.set(name, [line]);
  };

  for (const match of text.matchAll(/export\s*\{([^}]+)\}/g)) {
    const line = text.slice(0, match.index).split('\n').length;
    for (const item of match[1].split(',')) {
      const exported = item.trim().split(/\s+as\s+/)[1] || item.trim().split(/\s+/)[0];
      add(exported, line);
    }
  }
  for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    const line = text.slice(0, match.index).split('\n').length;
    add(match[1], line);
  }
  const duplicates = [...names.entries()].filter(([, lines]) => lines.length > 1);
  return duplicates.map(([name, lines]) => `${file}: ${name} exported on lines ${lines.join(', ')}`);
}

const files = changedFiles();
if (files.length === 0) {
  console.log(`CI quality gate: no changed JS/TS files relative to ${base}`);
  process.exit(0);
}

const duplicateFindings = files.flatMap(duplicateExports);
if (duplicateFindings.length) {
  console.error('Duplicate export check failed:');
  for (const finding of duplicateFindings) console.error(`  - ${finding}`);
  process.exitCode = 1;
}

try {
  execFileSync('npx', ['eslint', '--quiet', ...files], { cwd: root, stdio: 'inherit' });
  console.log(`Changed-file ESLint gate passed for ${files.length} file(s).`);
} catch {
  console.error('Changed-file ESLint gate failed: new lint errors were introduced.');
  process.exitCode = 1;
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`CI quality gate passed for ${files.length} changed JS/TS file(s).`);
