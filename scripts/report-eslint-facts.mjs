import fs from 'node:fs';

const inputPath = process.argv[2] || '/tmp/eslint-full.json';
const outputPath = process.argv[3] || '/tmp/eslint-facts.md';
const results = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const files = results.filter((entry) => entry.messages.length > 0);
const messages = files.flatMap((entry) => entry.messages.map((message) => ({ ...message, filePath: entry.filePath })));
const errors = messages.filter((message) => message.severity === 2);
const warnings = messages.filter((message) => message.severity === 1);
const byRule = (items) => Object.entries(items.reduce((acc, item) => {
  const rule = item.ruleId || 'configuration';
  acc[rule] = (acc[rule] || 0) + 1;
  return acc;
}, {})).sort((a, b) => b[1] - a[1]);
const byFile = (items) => Object.entries(items.reduce((acc, item) => {
  acc[item.filePath] = (acc[item.filePath] || 0) + 1;
  return acc;
}, {})).sort((a, b) => b[1] - a[1]);

const lines = [
  '# ESLint Fact Inventory',
  '',
  `- Files with findings: ${files.length}`,
  `- Error-severity findings: ${errors.length}`,
  `- Warning-severity findings: ${warnings.length}`,
  '',
  '## Error counts by rule',
  '',
  ...(byRule(errors).length ? byRule(errors).map(([rule, count]) => `- ${rule}: ${count}`) : ['- None']),
  '',
  '## Error files',
  '',
  ...(byFile(errors).length ? byFile(errors).map(([file, count]) => `- ${file}: ${count}`) : ['- None']),
  '',
  '## Warning counts by rule',
  '',
  ...byRule(warnings).map(([rule, count]) => `- ${rule}: ${count}`),
  '',
  '## Warning files',
  '',
  ...byFile(warnings).map(([file, count]) => `- ${file}: ${count}`),
  ''
];
fs.writeFileSync(outputPath, lines.join('\n'));
console.log(JSON.stringify({ files: files.length, errors: errors.length, warnings: warnings.length, errorRules: byRule(errors), errorFiles: byFile(errors) }, null, 2));
