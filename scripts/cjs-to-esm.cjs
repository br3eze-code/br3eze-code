#!/usr/bin/env node
'use strict';
/**
 * CJS → ESM mass migration
 * Strategy:
 *  - Top-level require() → import statement
 *  - module.exports / exports.x → export
 *  - __dirname/__filename → import.meta.dirname / import.meta.filename (Node 21+)
 *  - Indented/dynamic require() inside function bodies → leave require() intact,
 *    inject `createRequire` shim at top so they still work in ESM context
 *  - Files already ESM: skip
 */

const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node cjs-to-esm.cjs <file> [file...]'); process.exit(1); }

const DIRNAME_SHIM = `import { fileURLToPath } from 'url';\nimport { dirname } from 'path';\nconst __filename = fileURLToPath(import.meta.url);\nconst __dirname = dirname(__filename);\n`;
const CREATE_REQUIRE_SHIM = `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);\n`;

function resolveSpec(fromFile, spec) {
  if (!spec.startsWith('.')) return spec; // bare specifier — leave as-is
  if (/\.(json|mjs|cjs|node)$/.test(spec)) return spec;
  const abs = path.resolve(path.dirname(fromFile), spec);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const idx = path.join(abs, 'index.js');
    return fs.existsSync(idx) ? spec.replace(/\/?$/, '/index.js') : spec;
  }
  if (fs.existsSync(abs)) return spec; // exact match (no .js suffix needed)
  if (fs.existsSync(abs + '.js')) return spec + '.js';
  return spec; // can't resolve — leave bare
}

function convertFile(filePath) {
  let src = fs.readFileSync(filePath, 'utf8');

  // Skip files that are already ESM (have top-level import/export at col 0)
  if (/^(import |export )/m.test(src) && !(/^(const|let|var|require)\b/m.test(src))) {
    return { skipped: true };
  }

  const lines = src.split('\n');
  const importLines = [];  // collected import statements (de-duped by specifier)
  const outLines = [];
  const importedSpecs = new Map(); // spec -> local binding (to avoid dup imports)
  const flags = [];

  let needsCreateRequire = false;
  let usesDirname = false;
  let usesFilename = false;
  let changed = false;

  // Detect __dirname / __filename usage anywhere in source
  if (/\b__dirname\b/.test(src)) usesDirname = true;
  if (/\b__filename\b/.test(src)) usesFilename = true;

  // Check for require.main
  if (/require\.main/.test(src)) {
    src = src.replace(/require\.main\s*===?\s*module/g, "import.meta.url === process.argv[1] || import.meta.url.endsWith(process.argv[1])");
    changed = true;
  }

  // First pass: convert top-level require() and module.exports
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isTopLevel = /^\S/.test(line) || /^(const|let|var|module|exports)\b/.test(line);

    // Skip comment lines
    if (/^\s*(\/\/|\*)/.test(line)) { outLines.push(line); continue; }

    // ── Top-level: const { a, b: c } = require('x');
    {
      const m = line.match(/^(const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*(['"`])([^'"` ]+)\3\s*\)\s*;?\s*$/);
      if (m) {
        const [, , names, , spec] = m;
        const resolved = resolveSpec(filePath, spec);
        const parts = names.split(',').map(s => s.trim()).filter(Boolean);
        const converted = parts.map(p => {
          const rm = p.match(/^([\w$]+)\s*:\s*([\w$]+)$/);
          return rm ? `${rm[1]} as ${rm[2]}` : p;
        });
        importLines.push(`import { ${converted.join(', ')} } from '${resolved}';`);
        changed = true;
        continue;
      }
    }

    // ── Top-level: const x = require('y');
    {
      const m = line.match(/^(const|let|var)\s+([\w$]+)\s*=\s*require\(\s*(['"`])([^'"` ]+)\3\s*\)\s*;?\s*$/);
      if (m) {
        const [, , name, , spec] = m;
        const resolved = resolveSpec(filePath, spec);
        importLines.push(`import ${name} from '${resolved}';`);
        changed = true;
        continue;
      }
    }

    // ── Top-level: const x = require('y').prop;
    {
      const m = line.match(/^(const|let|var)\s+([\w$]+)\s*=\s*require\(\s*(['"`])([^'"` ]+)\3\s*\)\.([\w$]+)\s*;?\s*$/);
      if (m) {
        const [, , name, , spec, prop] = m;
        const resolved = resolveSpec(filePath, spec);
        // import { prop as name } from 'spec' — if prop === name, just { prop }
        if (prop === name) {
          importLines.push(`import { ${prop} } from '${resolved}';`);
        } else {
          importLines.push(`import { ${prop} as ${name} } from '${resolved}';`);
        }
        changed = true;
        continue;
      }
    }

    // ── Top-level: require('x') (side-effect only)
    {
      const m = line.match(/^require\(\s*(['"`])([^'"` ]+)\1\s*\)\s*;?\s*$/);
      if (m) {
        const resolved = resolveSpec(filePath, m[2]);
        importLines.push(`import '${resolved}';`);
        changed = true;
        continue;
      }
    }

    // ── Top-level: require('x').config(...) / require('dotenv').config()
    {
      const m = line.match(/^require\(\s*(['"`])(dotenv)\1\s*\)\.(config)\([^)]*\)\s*;?\s*$/);
      if (m) {
        importLines.push(`import 'dotenv/config';`);
        changed = true;
        continue;
      }
    }

    // ── module.exports = { ... } (object literal)
    {
      const m = line.match(/^module\.exports\s*=\s*\{(.*)$/);
      if (m) {
        // Multi-line or single-line object
        let obj = m[1];
        let j = i;
        while (!obj.includes('}') && j + 1 < lines.length) {
          j++;
          obj += '\n' + lines[j];
        }
        // Extract keys from the object — if they look like { a, b, c }
        const inner = obj.replace(/\}[^}]*$/, '').trim().replace(/,$/, '');
        const keys = inner.split(',').map(k => k.trim()).filter(k => /^[\w$]+$/.test(k));
        if (keys.length && inner.split('\n').every(l => /^\s*[\w$]+\s*(,\s*)?$/.test(l.trim()) || l.trim() === '')) {
          outLines.push(`export { ${keys.join(', ')} };`);
        } else {
          // Complex expression — use export default
          const rest = obj.replace(/\}[^}]*$/, '').trim();
          // Reconstruct — just do export { ... } if simple names, else default
          outLines.push(`export default {${obj}`);
        }
        i = j;
        changed = true;
        continue;
      }
    }

    // ── module.exports = IDENTIFIER;
    {
      const m = line.match(/^module\.exports\s*=\s*([\w$]+)\s*;?\s*$/);
      if (m) {
        outLines.push(`export default ${m[1]};`);
        changed = true;
        continue;
      }
    }

    // ── module.exports.x = y; OR exports.x = y;
    {
      const m = line.match(/^(?:module\.)?exports\.([\w$]+)\s*=\s*(.+)\s*;?\s*$/);
      if (m) {
        const [, name, val] = m;
        // If exporting an already declared identifier, use export { name }
        if (/^[\w$]+$/.test(val.trim())) {
          outLines.push(`export { ${val.trim()} as ${name} };`);
        } else {
          outLines.push(`export const ${name} = ${val};`);
        }
        changed = true;
        continue;
      }
    }

    // ── 'use strict'; (strip — ESM is always strict)
    if (line.trim() === "'use strict';" || line.trim() === '"use strict";') {
      changed = true;
      continue; // drop it
    }

    // ── Indented / dynamic require() — flag and keep, will add createRequire shim
    if (/\brequire\s*\(/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
      needsCreateRequire = true;
      flags.push(`L${i + 1}: dynamic require`);
    }

    outLines.push(line);
  }

  if (!changed) return { skipped: true };

  // Build preamble
  const preamble = [];

  if (needsCreateRequire) {
    preamble.push(CREATE_REQUIRE_SHIM);
  }
  if (usesDirname || usesFilename) {
    // Node 21+ has import.meta.dirname / import.meta.filename but add compat shim
    preamble.push(DIRNAME_SHIM);
  }

  // De-duplicate imports
  const seen = new Set();
  const dedupedImports = [];
  for (const imp of importLines) {
    if (!seen.has(imp)) { seen.add(imp); dedupedImports.push(imp); }
  }

  let result = [...dedupedImports, ...(preamble.length ? ['', ...preamble] : []), '', ...outLines].join('\n');

  // Clean up multiple consecutive blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  return { result, flags };
}

let totalConverted = 0, totalSkipped = 0, totalFlagged = 0;

for (const f of files) {
  try {
    const { result, skipped, flags = [] } = convertFile(f);
    if (skipped) { totalSkipped++; continue; }
    fs.writeFileSync(f, result, 'utf8');
    totalConverted++;
    if (flags.length) {
      totalFlagged++;
      console.log(`[flagged] ${f}: ${flags.join(', ')}`);
    }
  } catch (err) {
    console.error(`[error] ${f}: ${err.message}`);
  }
}

console.log(`\nDone: ${totalConverted} converted, ${totalSkipped} skipped, ${totalFlagged} with dynamic requires (createRequire added).`);
