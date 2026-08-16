import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const base = path.join(repo, '.security-review', 'multi-manifest');
const summary = JSON.parse(fs.readFileSync(path.join(base, 'multi-manifest-summary.json'), 'utf8'));
const groups = new Map();
for (const item of summary.criticalHighDetails) {
  const key = [item.severity, item.package, item.url, item.range].join('|');
  if (!groups.has(key)) groups.set(key, { ...item, surfaces: new Set(), occurrences: 0 });
  const group = groups.get(key);
  group.surfaces.add(item.surface);
  group.occurrences += 1;
}
const grouped = [...groups.values()].map((g) => ({ ...g, surfaces: [...g.surfaces].sort() })).sort((a, b) => a.severity.localeCompare(b.severity) || a.package.localeCompare(b.package) || a.title.localeCompare(b.title));
const bySurface = new Map();
for (const item of grouped) for (const surface of item.surfaces) bySurface.set(surface, (bySurface.get(surface) ?? 0) + 1);
const lines = [
  '# Multi-manifest local security audit report', '',
  `Generated: ${summary.generatedAt}`, '',
  '## Reproducible local results', '',
  `The isolated npm audit sweep covered **${summary.surfaces.length} resolved surfaces**. The non-deduplicated sum is **${summary.totals.total} findings**, including **${summary.totals.critical} critical** and **${summary.totals.high} high** entries.`, '',
  'The counts are not a repository-wide unique advisory count: the same advisory can occur in multiple independently resolved plugin manifests. The root lockfile reports 0 critical and 0 high; the nested Cordova SQLite lockfile reports 0 critical and 0 high.', '',
  '## Highest-risk surfaces', '',
  '| Surface | Critical/high detail records | Interpretation |',
  '|---|---:|---|',
  ...[...bySurface.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([surface, count]) => `| ${surface} | ${count} | Requires reachability and dependency-path review |`), '',
  '## Critical/high advisory groups', '',
  '| Severity | Package | Advisory | Range | Occurrences | Surfaces |',
  '|---|---|---|---|---:|---|',
  ...grouped.map((g) => `| ${g.severity} | ${g.package} | ${g.url || g.title} | ${g.range || 'not reported'} | ${g.occurrences} | ${g.surfaces.length} |`), '',
  '## Specialist remediation order', '',
  '1. **Engineer** confirms whether each package is runtime-reachable, build-only, test-only, or plugin-development-only and maps each advisory to a direct or transitive dependency path.',
  '2. **Project Manager and Planner** create one WBS package per unique advisory group, sequence critical runtime paths first, and track activity numbers, float, and release gates.',
  '3. **Procurement** evaluates maintained replacements, licensing, support, and buy-versus-build options for abandoned packages.',
  '4. **Expeditor** tracks upstream fixes and supplier or maintainer responses for blocked upgrades.',
  '5. **QA** runs security regression, tenant-isolation, payment, courier, channel, and platform tests after each dependency wave.',
  '6. **Editor and Draftsman** maintain the controlled advisory register, dependency map, upgrade notes, and rollback runbook.',
  '7. **Accountant and Secretary** record remediation cost, approvals, decisions, deadlines, and release communication.', '',
  '## Evidence limitations', '',
  'The GitHub Dependabot endpoint returned HTTP 403 in this environment, so the remote aggregate of 7 critical and 70 high findings could not be mapped to advisory IDs. The local audit used temporary lockfiles for lockless manifests and did not modify the repository manifests. Temporary resolution can differ from the exact dependency graph used by the project build. Treat these results as a reproducible discovery set, not as a final release decision, until canonical lockfiles are generated and reviewed.', ''
];
fs.writeFileSync(path.join(base, 'multi-manifest-report.md'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(base, 'multi-manifest-groups.json'), JSON.stringify({ generatedAt: summary.generatedAt, groups: grouped }, null, 2) + '\n');
console.log(`unique critical/high groups: ${grouped.length}`);
console.log(`surfaces: ${summary.surfaces.length}`);
console.log(`non-deduplicated critical/high: ${summary.totals.critical + summary.totals.high}`);
