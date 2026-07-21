#!/usr/bin/env node
'use strict';
/**
 * ESM codemod v2 — incorporates every bug found during the migration:
 *  - only converts TOP-LEVEL (col-0) require()/module.exports statements;
 *    anything indented is left alone and flagged for manual review
 *    (function-scoped requires are usually either lazy-optional-deps or
 *    genuinely dynamic, both of which need human judgement)
 *  - never touches comment lines
 *  - resolves relative specifiers to include .js (or /index.js for dirs)
 *  - renamed destructure (const { a: b } = require(x)) -> import { a as b }
 *  - self-referential exports.X = X (re-export of already-declared local) ->
 *    export { X }, not export const X = X
 *  - module.exports = EXPR (any expression, not just simple identifiers) ->
 *    export default EXPR
 *  - flags require.main === module, __dirname/__filename usage separately
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
const report = { converted: [], flagged: [] };

function resolveExt(fromFile, spec) {
  if (!spec.startsWith('.')) return spec;
  if (spec.endsWith('.json')) return spec;
  const abs = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    return spec.replace(/\/?$/, '') + '/index.js';
  }
  if (fs.existsSync(abs + '.js')) return spec + '.js';
  return spec.endsWith('.js') ? spec : spec + '.js';
}

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const out = [];
  const flags = [];
  let usesDirname = false, usesFilename = false, usesReqMain = false;

  for (const line of lines) {
    // skip comment-ish lines untouched
    if (/^\s*(\*|\/\/)/.test(line)) { out.push(line); continue; }

    let m;

    // top-level: const { a: b, c } = require('spec');
    m = line.match(/^const\s*\{([^}]+)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)\s*;?\s*$/);
    if (m) {
      const [, names, , spec] = m;
      const parts = names.split(',').map(s => s.trim()).filter(Boolean);
      const converted = parts.map(p => {
        const rm = p.match(/^([\w$]+)\s*:\s*([\w$]+)$/);
        return rm ? `${rm[1]} as ${rm[2]}` : p;
      });
      out.push(`import { ${converted.join(', ')} } from '${resolveExt(file, spec)}';`);
      continue;
    }

    // top-level: const X = require('spec').prop;
    m = line.match(/^const\s+([\w$]+)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)\.([\w$]+)\s*;?\s*$/);
    if (m) {
      const [, varName, , spec, prop] = m;
      out.push(`import { ${prop} as ${varName} } from '${resolveExt(file, spec)}';`);
      continue;
    }

    // top-level: const X = require('spec');
    m = line.match(/^const\s+([\w$]+)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)\s*;?\s*$/);
    if (m) {
      const [, varName, , spec] = m;
      out.push(`import ${varName} from '${resolveExt(file, spec)}';`);
      continue;
    }

    // top-level bare require('spec');
    m = line.match(/^require\(\s*(['"])([^'"]+)\1\s*\)\s*;?\s*$/);
    if (m) {
      out.push(`import '${resolveExt(file, m[2])}';`);
      continue;
    }

    // module.exports = EXPR;  (any expression)
    m = line.match(/^module\.exports\s*=\s*(.+)$/);
    if (m) {
      out.push(`export default ${m[1]}`);
      continue;
    }

    // module.exports.X = Y;  or exports.X = Y;
    m = line.match(/^(?:module\.)?exports\.([\w$]+)\s*=\s*([\w$]+)\s*;?\s*$/);
    if (m) {
      const [, name, value] = m;
      if (name === value) {
        out.push(`export { ${name} };`);
      } else {
        out.push(`export const ${name} = ${value};`);
      }
      continue;
    }
    m = line.match(/^(?:module\.)?exports\.([\w$]+)\s*=\s*(.+?);?\s*$/);
    if (m) {
      out.push(`export const ${m[1]} = ${m[2]};`);
      continue;
    }

    if (/require\.main\s*===?\s*module/.test(line)) usesReqMain = true;
    if (/\b__dirname\b/.test(line)) usesDirname = true;
    if (/\b__filename\b/.test(line)) usesFilename = true;

    if (/^\s*require\(/.test(line) || /=\s*require\(/.test(line)) {
      flags.push(line.trim());
    }

    out.push(line);
  }

  let result = out.join('\n');

  if (usesDirname || usesFilename) {
    flags.push('USES_DIRNAME_SHIM');
  }
  if (usesReqMain) {
    flags.push('USES_REQUIRE_MAIN');
  }

  fs.writeFileSync(file, result);
  if (flags.length) report.flagged.push({ file, flags });
  else report.converted.push(file);
}

console.log(JSON.stringify(report, null, 2));
