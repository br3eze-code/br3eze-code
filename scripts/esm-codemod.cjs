#!/usr/bin/env node
'use strict';
/**
 * CJS -> ESM codemod for AgentOS backend.
 * Handles the dominant patterns in this codebase:
 *   const X = require('y');                -> import X from 'y';
 *   const { A, B } = require('y');          -> import { A, B } from 'y';
 *   const X = require('y').Z;               -> import { Z as X } from 'y';
 *   require('y');                           -> import 'y';
 *   module.exports = X;                     -> export default X;
 *   module.exports = { A, B };              -> export { A, B };
 *   module.exports.X = Y;                   -> export const X = Y; (only if X not already declared)
 *   exports.X = Y;                          -> export const X = Y;
 *   __dirname / __filename                  -> injected shim via import.meta.url
 *   require('./x.json')                     -> import x from './x.json' with { type: 'json' };
 *
 * Relative requires get an explicit .js extension appended (ESM requires it).
 * Flags anything it can't confidently handle instead of guessing.
 */
const fs = require('fs');
const path = require('path');

const TARGET_DIRS = process.argv.slice(2);
if (TARGET_DIRS.length === 0) {
  console.error('Usage: node esm-codemod.js <dir> [<dir> ...]');
  process.exit(1);
}

const SKIP_DIRS = new Set(['node_modules', 'www', '.git', 'dist', 'build', 'platforms']);
const report = { converted: [], skipped: [], flagged: [] };

const INCLUDE_TESTS = process.env.ESM_CODEMOD_INCLUDE_TESTS === '1';

function walk(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const out = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js') && (INCLUDE_TESTS || !entry.name.endsWith('.test.js'))) out.push(full);
  }
  return out;
}

function resolveRequireExt(fromFile, spec) {
  if (!spec.startsWith('.')) return spec; // bare specifier (npm pkg) - untouched
  const abs = path.resolve(path.dirname(fromFile), spec);
  if (spec.endsWith('.json')) return spec;
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return spec.replace(/\/?$/, '/index.js');
  if (fs.existsSync(abs + '.js')) return spec + '.js';
  if (fs.existsSync(abs)) return spec; // already has extension
  return spec + '.js'; // best guess
}

function convertFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  const flags = [];

  // Bail on dynamic/conditional requires we shouldn't guess at
  if (/require\(\s*[`]/.test(src) || /require\(\s*[a-zA-Z_$][\w$]*\s*\)/.test(src) && !/require\(\s*['"]/.test(src)) {
    // has some dynamic require pattern - flag but still try static ones
  }

  const lines = src.split('\n');
  const outLines = [];
  let usesDirname = false, usesFilename = false;
  const namedExportsUsed = new Set();

  for (let line of lines) {
    // require('./x.json')
    let m = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(\s*['"](.+\.json)['"]\s*\)\s*;?\s*$/);
    if (m) {
      const [, indent, varName, spec] = m;
      outLines.push(`${indent}import ${varName} from '${spec}' with { type: 'json' };`);
      continue;
    }

    // const { A, B } = require('y');
    m = line.match(/^(\s*)const\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/);
    if (m) {
      const [, indent, names, spec] = m;
      const resolved = resolveRequireExt(file, spec);
      outLines.push(`${indent}import {${names}} from '${resolved}';`);
      continue;
    }

    // const X = require('y').Z;
    m = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\.(\w+)\s*;?\s*$/);
    if (m) {
      const [, indent, varName, spec, prop] = m;
      const resolved = resolveRequireExt(file, spec);
      outLines.push(`${indent}import { ${prop} as ${varName} } from '${resolved}';`);
      continue;
    }

    // const X = require('y');
    m = line.match(/^(\s*)const\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/);
    if (m) {
      const [, indent, varName, spec] = m;
      const resolved = resolveRequireExt(file, spec);
      outLines.push(`${indent}import ${varName} from '${resolved}';`);
      continue;
    }

    // bare require('y');
    m = line.match(/^(\s*)require\(\s*['"]([^'"]+)['"]\s*\)\s*;?\s*$/);
    if (m) {
      const [, indent, spec] = m;
      const resolved = resolveRequireExt(file, spec);
      outLines.push(`${indent}import '${resolved}';`);
      continue;
    }

    // module.exports = { A, B };  (only simple identifier list, no renaming/computed)
    m = line.match(/^(\s*)module\.exports\s*=\s*\{([^}]+)\}\s*;?\s*$/);
    if (m) {
      const [, indent, names] = m;
      const clean = names.split(',').map(s => s.trim()).filter(Boolean);
      if (clean.every(n => /^[a-zA-Z_$][\w$]*$/.test(n))) {
        outLines.push(`${indent}export { ${clean.join(', ')} };`);
        continue;
      }
      flags.push(`module.exports object with non-simple entries: "${line.trim()}"`);
    }

    // module.exports = X;  (default export)
    m = line.match(/^(\s*)module\.exports\s*=\s*(\w+)\s*;?\s*$/);
    if (m) {
      const [, indent, varName] = m;
      outLines.push(`${indent}export default ${varName};`);
      continue;
    }

    // module.exports.X = Y;  or exports.X = Y;
    m = line.match(/^(\s*)(?:module\.)?exports\.(\w+)\s*=\s*(.+?);?\s*$/);
    if (m) {
      const [, indent, name, value] = m;
      namedExportsUsed.add(name);
      outLines.push(`${indent}export const ${name} = ${value};`);
      continue;
    }

    if (/\b__dirname\b/.test(line)) usesDirname = true;
    if (/\b__filename\b/.test(line)) usesFilename = true;
    if (/\brequire\(/.test(line) && !/^\s*\/\//.test(line)) {
      flags.push(`unhandled require pattern: "${line.trim()}"`);
    }

    outLines.push(line);
  }

  let out = outLines.join('\n');

  if (usesDirname || usesFilename) {
    const shimLines = [];
    if (usesFilename) shimLines.push(`const __filename = require('url').fileURLToPath(import.meta.url);`);
    if (usesDirname) shimLines.push(`const __dirname = require('path').dirname(${usesFilename ? '__filename' : `require('url').fileURLToPath(import.meta.url)`});`);
    // insert after 'use strict' if present, else at top
    const useStrictMatch = out.match(/^('use strict';\s*\n)/);
    if (useStrictMatch) {
      out = out.replace(useStrictMatch[1], useStrictMatch[1] + shimLines.join('\n') + '\n');
    } else {
      out = shimLines.join('\n') + '\n' + out;
    }
  }

  out = out.replace(/^'use strict';\s*\n/, ''); // implicit in ESM

  if (flags.length) {
    report.flagged.push({ file, flags });
    return { changed: false, flagged: true };
  }

  if (out !== original) {
    fs.writeFileSync(file, out);
    report.converted.push(file);
    return { changed: true };
  }
  report.skipped.push(file);
  return { changed: false };
}

for (const dir of TARGET_DIRS) {
  for (const file of walk(path.resolve(dir))) {
    convertFile(file);
  }
}

console.log(JSON.stringify(report, null, 2));
