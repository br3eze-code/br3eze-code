import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const roots = ['src/core', 'src/kernel'];
const forbidden = /(?:mikrotik|firebase|supabase|telegram|dahua|pesapal|pesapay|stripe|courier|voucher|billing|shop|invoice|whatsapp|discord)/i;
const importPattern = /(?:from\s+|import\s*\(|require\s*\()(['"])([^'"]+)\1/g;
const violations = [];

function walk(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(relative);
    else if (/\.(?:js|mjs|ts|tsx)$/.test(entry.name)) inspect(relative);
  }
}

function inspect(relative) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[2];
    if (specifier.startsWith('.') && forbidden.test(specifier)) {
      violations.push(`${relative}: direct domain import ${specifier}`);
    }
  }
}

for (const directory of roots) walk(directory);
if (violations.length) {
  console.error('[architecture] forbidden core/kernel domain imports found:');
  console.error(violations.join('\n'));
  process.exit(1);
}
console.log(`[architecture] passed: ${roots.join(', ')} contain no direct adapter/provider imports`);
