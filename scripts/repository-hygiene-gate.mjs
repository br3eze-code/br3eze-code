#!/usr/bin/env node
/**
 * Repository hygiene gate. Checks the current tracked index, not just files
 * visible on disk, so ignore rules cannot hide already-tracked local artifacts.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function inspectTrackedPaths(paths, gitignore = '') {
  const findings = [];
  const rules = [
    { pattern: /(^|\/)\.claude\/settings\.local\.json$/i, reason: 'local AI/IDE settings must not be committed' },
    { pattern: /(^|\/)(?:\.env|[^/]+\.env)(?:\.(?!example$|sample$|template$)[^/]+)?$/i, reason: 'environment files must not be committed; use an example template' },
    { pattern: /\.(?:keystore|jks|p12|pfx|pem|key)$/i, reason: 'private keys and signing material must not be committed' },
    { pattern: /(^|\/)(?:serviceAccountKey|service-account|firebase-service-account|credentials?)(?:[^/]*?)\.json$/i, reason: 'service-account or credential JSON must not be committed' },
    { pattern: /(^|\/)[^/]+\.log$/i, reason: 'runtime logs must not be committed' },
  ];
  for (const file of paths) {
    for (const rule of rules) {
      if (rule.pattern.test(file)) {
        findings.push(`${file}: ${rule.reason}`);
        break;
      }
    }
  }
  const ignoreLines = gitignore.split(/\r?\n/).map(line => line.trim());
  if (ignoreLines.includes('package-lock.json') || ignoreLines.includes('/package-lock.json')) {
    findings.push('.gitignore: package-lock.json must not be ignored; reproducible npm installs require a tracked lockfile');
  }
  if (!paths.includes('package-lock.json')) {
    findings.push('package-lock.json: canonical npm lockfile is missing from the tracked index');
  }
  return findings;
}

function main() {
  let paths;
  try {
    paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
      .split('\0').filter(Boolean);
  } catch (error) {
    console.error('Repository hygiene gate requires a Git checkout.');
    process.exitCode = 2;
    return;
  }
  const gitignore = fs.existsSync('.gitignore') ? fs.readFileSync('.gitignore', 'utf8') : '';
  const findings = inspectTrackedPaths(paths, gitignore);
  if (findings.length) {
    console.error('Repository hygiene gate failed:');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Repository hygiene gate passed (${paths.length} tracked paths checked).`);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) main();
