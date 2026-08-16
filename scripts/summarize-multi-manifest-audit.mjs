import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const base = path.join(repo, '.security-review', 'multi-manifest');
const rows = [];
const details = [];

function readAudit(file, surface) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const v = data.metadata?.vulnerabilities ?? data.vulnerabilities ?? {};
    const row = { surface, file: path.relative(repo, file), critical: v.critical ?? 0, high: v.high ?? 0, moderate: v.moderate ?? 0, low: v.low ?? 0, total: v.total ?? 0 };
    rows.push(row);
    for (const [key, advisory] of Object.entries(data.vulnerabilities ?? {})) {
      const via = Array.isArray(advisory.via) ? advisory.via : [];
      for (const item of via) {
        if (typeof item === 'object' && ['critical', 'high'].includes(item.severity)) {
          details.push({ surface, package: key, severity: item.severity, title: item.title ?? '', url: item.url ?? '', range: item.range ?? '' });
        }
      }
    }
  } catch {
    // Ignore missing or non-JSON audit outputs; status evidence records the reason.
  }
}

readAudit(path.join(base, 'raw', 'root', 'npm-audit.json'), 'root-lockfile');
readAudit(path.join(base, 'raw', 'cordova-sqlite-storage', 'npm-audit.json'), 'cordova-sqlite-lockfile');
const locklessDir = path.join(base, 'raw', 'lockless');
if (fs.existsSync(locklessDir)) {
  for (const file of fs.readdirSync(locklessDir).filter((name) => name.endsWith('.json'))) {
    readAudit(path.join(locklessDir, file), `lockless:${file.replace(/\.json$/, '')}`);
  }
}

const totals = rows.reduce((acc, row) => {
  for (const key of ['critical', 'high', 'moderate', 'low', 'total']) acc[key] += Number(row[key] || 0);
  return acc;
}, { critical: 0, high: 0, moderate: 0, low: 0, total: 0 });

const output = { generatedAt: new Date().toISOString(), surfaces: rows, totals, criticalHighDetails: details };
fs.writeFileSync(path.join(base, 'multi-manifest-summary.json'), JSON.stringify(output, null, 2) + '\n');
const markdown = [
  '# Multi-manifest local dependency audit', '',
  `Generated: ${output.generatedAt}`, '',
  '## Aggregate local results', '',
  '| Surface | Critical | High | Moderate | Low | Total |',
  '|---|---:|---:|---:|---:|---:|',
  ...rows.map((r) => `| ${r.surface} | ${r.critical} | ${r.high} | ${r.moderate} | ${r.low} | ${r.total} |`),
  `| **Sum of audit surfaces** | **${totals.critical}** | **${totals.high}** | **${totals.moderate}** | **${totals.low}** | **${totals.total}** |`, '',
  '## Interpretation', '',
  'These are local npm audit results across independently resolved package surfaces. They are not a deduplicated repository-wide count and must not be compared one-to-one with the GitHub Dependabot aggregate until advisory IDs and dependency paths are normalized.', '',
  `Critical/high advisory detail records captured: **${details.length}**.`, ''
].join('\n');
fs.writeFileSync(path.join(base, 'multi-manifest-summary.md'), markdown + '\n');
console.log(JSON.stringify(output, null, 2));
