#!/usr/bin/env node
'use strict';
/**
 * Pass 2: fixes for patterns pass 1 flagged instead of guessed at.
 *  - require('dotenv').config(...)          -> import 'dotenv/config'; (top) + drop line
 *  - inline require('node:builtin').fn(...) -> hoist to top import, rewrite call site
 *  - require('./x.json') (already caught mostly by pass1, remaining edge cases)
 *  - comment-only false positives are left untouched (harmless)
 */
const fs = require('fs');
const path = require('path');

const BUILTIN_INLINE = ['fs', 'fs/promises', 'crypto', 'path', 'dgram', 'perf_hooks', 'url'];

const files = process.argv.slice(2);

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const original = src;
  const neededImports = new Map(); // localName -> spec

  // dotenv.config()
  if (/require\(['"]dotenv['"]\)\.config\(/.test(src)) {
    src = src.replace(/^\s*require\(['"]dotenv['"]\)\.config\([^)]*\)\s*;?\s*\n/m, (m) => {
      // preserve custom path option if present
      if (/path\s*:/.test(m)) {
        return `import dotenv from 'dotenv';\n` + m.replace('require(\'dotenv\')', 'dotenv');
      }
      return `import 'dotenv/config';\n`;
    });
  }

  for (const mod of BUILTIN_INLINE) {
    const re = new RegExp(`require\\((['"])${mod}\\1\\)`, 'g');
    if (re.test(src)) {
      const localName = mod.replace('/', '_').replace(/^node:/, '');
      neededImports.set(localName, mod);
      src = src.replace(re, localName);
    }
  }

  if (neededImports.size) {
    const importLines = [...neededImports.entries()]
      .map(([local, spec]) => `import ${local} from '${spec}';`)
      .join('\n');
    if (/^'use strict';\s*\n/.test(src)) {
      src = src.replace(/^'use strict';\s*\n/, importLines + '\n');
    } else {
      src = importLines + '\n' + src;
    }
  }

  if (src !== original) {
    fs.writeFileSync(file, src);
    console.log('fixed:', file);
  } else {
    console.log('unchanged:', file);
  }
}
