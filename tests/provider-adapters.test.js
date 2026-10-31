import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('provider adapter boundaries', () => {
  test('product query bridge uses registered providers and does not import Firebase directly', () => {
    const source = read('src/core/product-query-service-bridge.js');
    expect(source).toContain("from '../plugin-sdk/index.js'");
    expect(source).toContain("from './sqlite-db.js'");
    expect(source).toContain("sdk.hasProvider('document-store')");
    expect(source).not.toContain("from './firebase.js'");
    expect(source).not.toMatch(/from ['"]firebase-admin['"]|require\(['"]firebase-admin['"]\)/);
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

  test('frontend provider port loads before SDKs and provider implementations', () => {
    const html = read('www/index.html');
    const adapter = html.indexOf('js/05.provider-adapter.js');
    const firebaseSdk = html.indexOf('firebase-app-compat.js');
    const firebaseInit = html.indexOf('js/06.firebase.js');

    expect(adapter).toBeGreaterThanOrEqual(0);
    expect(firebaseSdk).toBeGreaterThan(adapter);
    expect(firebaseInit).toBeGreaterThan(firebaseSdk);
    expect(html).toContain('firebase-auth-compat.js');
    expect(html).toContain('firebase-firestore-compat.js');
    expect(html).toContain('firebase-storage-compat.js');
    expect(read('www/js/06.firebase.js')).toContain('AgentOSProviders?.registerData');
  });
});
