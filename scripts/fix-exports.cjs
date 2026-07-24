#!/usr/bin/env node
'use strict';
/**
 * Fix remaining module.exports / exports.x in files that are otherwise already ESM.
 * Also fixes require() calls not caught by the first pass.
 */
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
let fixed = 0;

for (const f of files) {
  try {
    let c = fs.readFileSync(f, 'utf8');
    const original = c;

    // Fix: module.exports = { a, b, c } (simple identifier list, possibly multiline)
    c = c.replace(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;/g, (full, inner) => {
      // Check if inner is just identifiers (no inline objects/functions beyond simple ones)
      const trimmed = inner.trim();
      // If it contains nested { }, it's complex — use export default
      const nestLevel = (trimmed.match(/\{/g) || []).length;
      if (nestLevel > 0) {
        // Export default for complex objects
        return 'export default {' + inner + '};';
      }
      // Simple list of names (possibly with trailing commas)
      const keys = trimmed.split(',').map(k => k.trim()).filter(k => /^[\w$]+$/.test(k));
      if (!keys.length) return full; // leave unchanged
      return 'export { ' + keys.join(', ') + ' };';
    });

    // Fix: module.exports = SomeName;
    c = c.replace(/^module\.exports\s*=\s*([\w$]+)\s*;/mg, 'export default $1;');

    // Fix: module.exports.x = val; or exports.x = val;
    c = c.replace(/^(?:module\.)?exports\.([\w$]+)\s*=\s*(.+);/mg, (m, name, val) => {
      if (/^[\w$]+$/.test(val.trim())) return `export { ${val.trim()} as ${name} };`;
      return `export const ${name} = ${val};`;
    });

    // Fix remaining top-level require() that wasn't caught (no createRequire already present)
    if (!c.includes('createRequire') && /^(const|let|var)\s+\w+\s*=\s*require\(/.test(c)) {
      c = `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);\n` + c;
    }

    if (c !== original) {
      fs.writeFileSync(f, c);
      fixed++;
    }
  } catch (e) {
    console.error('[error]', f, e.message);
  }
}
console.log(`Fixed ${fixed} files.`);
