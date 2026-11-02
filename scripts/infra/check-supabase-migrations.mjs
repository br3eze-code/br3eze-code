import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareMigrationHistory } from '../../src/core/infrastructure/reconciliation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const snapshot = JSON.parse(await readFile(path.join(root, 'infra/observed/remote-snapshot.json'), 'utf8'));
const names = (await readdir(path.join(root, 'supabase/migrations'))).filter((name) => name.endsWith('.sql')).sort();
const local = names.map((file) => {
  const match = file.match(/^(\d{14})_(.+)\.sql$/);
  if (!match) throw new Error('Invalid migration filename: ' + file);
  return { version: match[1], name: match[2] };
});
const report = compareMigrationHistory({ local, remote: snapshot.supabase.migrations });
console.log(JSON.stringify(report, null, 2));
if (report.versionMismatches.length || report.localOnly.length || report.remoteOnly.length) process.exitCode = 1;
