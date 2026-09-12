import { assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

const KERNEL_FILES = [
  'src/core/node-registry.js',
  'src/core/capability-boundary.js',
  'src/core/saas-boundary.js',
  'src/core/taskRegistry.js',
  'src/core/tool-registry.js',
];

const FORBIDDEN_DOMAIN_IMPORTS = [
  /(?:mikrotik|starlink|wifi|voucher|mastercard|telegram|whatsapp)/i,
];

describe('kernel domain isolation', () => {
  test('kernel boundary files contain no concrete product/vendor imports', async () => {
    for (const file of KERNEL_FILES) {
      const source = await readFile(new URL(`../../${file}`, import.meta.url), 'utf8');
      for (const pattern of FORBIDDEN_DOMAIN_IMPORTS) {
        const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line));
        assert.equal(importLines.some((line) => pattern.test(line)), false, `${file} imports a concrete domain/vendor`);
      }
    }
  });
});
