import fs from 'node:fs';

const inputPath = process.argv[2] || '/tmp/eslint-report.json';
const outputPath = process.argv[3] || 'docs/eslint-error-inventory.md';
const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const rows = [];
const ruleCounts = new Map();
let errors = 0;
let warnings = 0;
for (const file of report) {
  const messages = file.messages || [];
  const fileErrors = messages.filter((message) => message.severity === 2);
  const fileWarnings = messages.filter((message) => message.severity === 1);
  errors += fileErrors.length;
  warnings += fileWarnings.length;
  if (messages.length === 0) continue;
  const relative = file.filePath.replace(`${process.cwd()}/`, '');
  rows.push({ file: relative, errors: fileErrors.length, warnings: fileWarnings.length, messages });
  for (const message of messages) {
    const rule = message.ruleId || 'parse-error';
    ruleCounts.set(rule, (ruleCounts.get(rule) || 0) + 1);
  }
}
rows.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || a.file.localeCompare(b.file));
const rules = [...ruleCounts.entries()].sort((a, b) => b[1] - a[1]);
const lines = [
  '# Repository ESLint Error Inventory',
  '',
  `Generated from repository-wide ESLint JSON output. Total errors: **${errors}**. Total warnings: **${warnings}**. Files with findings: **${rows.length}**.`,
  '',
  '## Rule totals',
  '',
  '| Rule | Findings |',
  '|---|---:|',
  ...rules.map(([rule, count]) => `| \`${rule}\` | ${count} |`),
  '',
  '## Files with findings',
  '',
  '| File | Errors | Warnings | Rules |',
  '|---|---:|---:|---|',
  ...rows.map(({ file, errors: fileErrors, warnings: fileWarnings, messages }) => {
    const fileRules = [...new Set(messages.map((message) => `\`${message.ruleId || 'parse-error'}\``))].sort().join(', ');
    return `| \`${file}\` | ${fileErrors} | ${fileWarnings} | ${fileRules} |`;
  }),
  '',
  '## Detailed findings',
  '',
  ...rows.flatMap(({ file, messages }) => [
    `### ${file}`,
    '',
    ...messages.map((message) => `- **${message.line}:${message.column}** \`${message.ruleId || 'parse-error'}\`: ${message.message}`),
    ''
  ])
];
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ errors, warnings, files: rows.length, topRules: rules.slice(0, 15) }, null, 2));
