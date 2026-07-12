#!/usr/bin/env node
'use strict';
const fs = require('fs');

const files = [...new Set(process.argv.slice(2))];
const IMPORT_RE = /^([ \t]+)import\s+(.+?)\s+from\s+(['"][^'"]+['"]);?\s*$/;

for (const file of files) {
  let src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  // Collect top-level (col-0) import specifiers already present, keyed by spec.
  const topLevelBySpec = new Map(); // spec -> full import line text (col-0)
  lines.forEach((l) => {
    const m = l.match(/^import\s+(.+?)\s+from\s+(['"][^'"]+['"]);?\s*$/);
    if (m) {
      const spec = m[2];
      if (!topLevelBySpec.has(spec)) topLevelBySpec.set(spec, []);
      topLevelBySpec.get(spec).push(l.trim());
    }
  });

  const toHoist = []; // lines (col-0 form) to add at top, deduped
  const outLines = [];
  let changed = false;

  for (const line of lines) {
    const m = line.match(IMPORT_RE);
    if (m) {
      const [, , binding, spec] = m;
      const col0 = `import ${binding} from ${spec};`;
      const existing = topLevelBySpec.get(spec) || [];
      const exactDup = existing.some((e) => e === col0);
      if (exactDup) {
        // redundant - drop the line entirely
        changed = true;
        continue;
      }
      // not present at top yet (or a different binding shape for same spec) - hoist it
      if (!toHoist.includes(col0)) toHoist.push(col0);
      changed = true;
      continue; // remove from original position
    }
    outLines.push(line);
  }

  if (!changed) continue;

  let out = outLines.join('\n');
  if (toHoist.length) {
    // insert after the last existing top-level import, or after shebang, or at top
    const outArr = out.split('\n');
    let insertAt = 0;
    for (let i = 0; i < outArr.length; i++) {
      if (/^import\s/.test(outArr[i]) || /^#!/.test(outArr[i])) insertAt = i + 1;
      else if (outArr[i].trim() === '' && insertAt > 0) continue;
      else if (insertAt > 0) break;
    }
    outArr.splice(insertAt, 0, ...toHoist);
    out = outArr.join('\n');
  }

  fs.writeFileSync(file, out);
  console.log('hoisted in', file, '(+' + toHoist.length + ' new, dedup rest)');
}
