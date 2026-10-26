#!/usr/bin/env node
/**
 * Transitional source audit for AgentOS execution ownership.
 * Static matches are leads, not proof of production reachability.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scanRoots = ['src/core', 'src/ai', 'src/harness', 'src/kernel', 'src/runtime', 'src/cli', 'src/api', 'src/channels'];
const skipDirs = new Set(['node_modules', '.git', 'coverage', 'dist', 'build']);
const engineConstructors = /\bnew\s+(AgentRuntime|AgentKernel|AICoordinator|UniversalAICoordinator|AgentOS|AgentHarness|AskEngine|LLMCoordinator)\s*\(/g;
const providerImport = /(?:from\s*|import\s*\()\s*['"](?:@google\/generative-ai|@anthropic-ai\/sdk|openai|firebase|firebase-admin|@supabase\/supabase-js)['"]/;
const findings = [];

async function collect(dir) {
  let entries;
  try { entries = await readdir(path.join(root, dir), { withFileTypes: true }); }
  catch { return []; }
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) files.push(...await collect(relative));
    } else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
      files.push(relative);
    }
  }
  return files;
}

for (const scanRoot of scanRoots) {
  for (const relative of await collect(scanRoot)) {
    const source = await readFile(path.join(root, relative), 'utf8');
    const lines = source.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      engineConstructors.lastIndex = 0;
      for (const match of line.matchAll(engineConstructors)) {
        findings.push({
          category: 'runtime-construction',
          file: relative,
          line: index + 1,
          symbol: match[1],
          severity: match[1] === 'AgentRuntime' && relative === 'src/core/agentRuntime.js' ? 'canonical-definition' : 'review',
          source: line.trim().slice(0, 220),
        });
      }
      if (relative.startsWith('src/core/') && providerImport.test(line)) {
        findings.push({
          category: 'provider-in-core',
          file: relative,
          line: index + 1,
          severity: 'review',
          source: line.trim().slice(0, 220),
        });
      }
    }
  }
}

const reviewFindings = findings.filter((item) => item.severity === 'review');
console.log('AgentOS runtime-boundary source audit');
console.log('=====================================');
console.log('Canonical runtime contract: src/core/agentRuntime.js');
console.log('Files scanned: ' + scanRoots.join(', '));
console.log('Findings: ' + findings.length + '; require review: ' + reviewFindings.length);
for (const item of findings) {
  console.log('[' + item.severity + '] ' + item.category + ' ' + item.file + ':' + item.line + (item.symbol ? ' (' + item.symbol + ')' : ''));
  console.log('  ' + item.source);
}
if (!findings.length) console.log('No runtime-construction or provider-boundary patterns found.');
console.log('');
console.log('Important: matches are static leads, not proof of production reachability.');
console.log('Trace imports/callers and preserve behavior before migrating or deleting a path.');
if (process.argv.includes('--strict') && reviewFindings.length) {
  console.error('STRICT AUDIT FAILED: ' + reviewFindings.length + ' finding(s) need explicit disposition.');
  process.exitCode = 1;
}
