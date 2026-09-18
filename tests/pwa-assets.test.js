import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

describe('PWA and Cordova web assets', () => {
  test('manifest is installable and uses a stable relative identity', () => {
    const manifest = JSON.parse(read('www/manifest.json'));

    expect(manifest.id).toBe('./');
    expect(manifest.start_url).toBe('./index.html');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.prefer_related_applications).toBe(false);
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
      expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
    ]));
  });

  test('service worker caches every declared shell asset', () => {
    const serviceWorker = read('www/sw.js');
    const shellSource = serviceWorker.slice(serviceWorker.indexOf('const APP_SHELL'), serviceWorker.indexOf('];', serviceWorker.indexOf('const APP_SHELL')));
    const shell = [...shellSource.matchAll(/[\'"]([^\'"]+)[\'"]/g)].map((match) => match[1]);

    expect(serviceWorker).toContain("const CACHE_NAME = 'agentos-shell-v9'");
    expect(serviceWorker).toContain("const OFFLINE_DOCUMENT = './index.html'");
    for (const asset of shell) {
      if (asset.startsWith('http') || asset === './') continue;
      expect(fs.existsSync(path.join(root, 'www', asset.replace(/^\.\//, '')))).toBe(true);
    }
  });

  test('index registers the service worker only in supported web contexts', () => {
    const index = read('www/index.html');

    expect(index).toContain("'serviceWorker' in navigator");
    expect(index).toContain("window.location.protocol === 'https:'");
    expect(index).toContain("navigator.serviceWorker.register('sw.js')");
    expect(index).toContain("if (window.location.protocol === 'file:'");
    expect(index).toContain("/Cordova/i.test(navigator.userAgent)");
  });

  test('configured custom plugins have local manifests', () => {
    const config = read('config.xml');
    const configured = [...config.matchAll(/<plugin name="([^"]+)"/g)].map((match) => match[1]);
    const localIds = fs.readdirSync(path.join(root, 'custom-plugins'))
      .map((name) => path.join(root, 'custom-plugins', name, 'plugin.xml'))
      .filter((file) => fs.existsSync(file))
      .map((file) => read(path.relative(root, file)).match(/<plugin\b[^>]*\bid="([^"]+)"/)?.[1])
      .filter(Boolean);

    expect(localIds).toEqual(expect.arrayContaining([
      'cordova-plugin-network-tools',
      'cordova-plugin-aicore',
      'cordova-plugin-wifi-billing-agent',
      'cordova-plugin-background-modern',
    ]));
    expect(configured.filter((name) => localIds.includes(name))).toEqual(expect.arrayContaining(localIds));
  });
});

 afterAll(() => undefined);
