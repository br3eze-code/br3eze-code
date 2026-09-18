import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('provider adapter boundaries', () => {
  test('core product query bridge depends on the persistence port, not Firebase', () => {
    const source = read('src/core/product-query-service-bridge.js');
    expect(source).toContain("from './persistence.js'");
    expect(source).not.toContain("from './firebase.js'");
  });

  test('backend provider SDK imports stay inside adapters', () => {
    const coreFiles = fs.readdirSync(path.join(root, 'src/core'), { recursive: true })
      .filter((file) => file.endsWith('.js'));
    const violations = coreFiles.filter((file) => {
      const source = read(path.join('src/core', file));
      return /from ['"](?:firebase-admin|@supabase\/supabase-js)['"]|require\(['"](?:firebase-admin|@supabase\/supabase-js)['"]\)/.test(source);
    });
    expect(violations).toEqual([]);
  });

  test('frontend provider port loads before provider implementations', () => {
    const html = read('www/index.html');
    expect(html.indexOf('js/05.provider-adapter.js')).toBeGreaterThanOrEqual(0);
    expect(html.indexOf('js/05.provider-adapter.js')).toBeLessThan(html.indexOf('firebase-app-compat.js'));
    expect(read('www/js/06.firebase.js')).toContain('AgentOSProviders?.registerData');
  });
});
