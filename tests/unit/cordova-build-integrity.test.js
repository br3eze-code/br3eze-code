import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd());
const require = createRequire(path.join(root, 'package.json'));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir, ext, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, ext, out);
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

describe('Cordova Android build integrity', () => {
  const configXml = read('config.xml');

  test('config.xml hooks load as functions through Cordova require()', () => {
    const hooks = [...configXml.matchAll(/<hook src="([^"]+)"/g)].map((m) => m[1]);
    expect(hooks.length).toBeGreaterThan(0);
    for (const h of hooks) {
      expect(h.endsWith('.js')).toBe(true);
      expect(require(path.join(root, h))).toBeInstanceOf(Function);
    }
  });

  const pluginDirs = fs
    .readdirSync(path.join(root, 'custom-plugins'), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, 'custom-plugins', d.name, 'plugin.xml')))
    .map((d) => path.join(root, 'custom-plugins', d.name));

  test.each(pluginDirs.map((d) => [path.basename(d), d]))('%s: every Android Java file is copied and named after its public class', (_, dir) => {
    const xml = fs.readFileSync(path.join(dir, 'plugin.xml'), 'utf8');
    const android = (xml.split('<platform name="android">')[1] || '').split('</platform>')[0];
    const copied = new Set([...android.matchAll(/<source-file src="([^"]+\.java)"/g)].map((m) => m[1]));
    for (const src of copied) expect(fs.existsSync(path.join(dir, src))).toBe(true);
    for (const file of walk(path.join(dir, 'src', 'android'), '.java')) {
      const rel = path.relative(dir, file).split(path.sep).join('/');
      expect({ file: rel, copied: copied.has(rel) }).toEqual({ file: rel, copied: true });
      const cls = fs.readFileSync(file, 'utf8').match(/public\s+(?:final\s+|abstract\s+)*(?:class|interface|enum)\s+(\w+)/);
      if (cls) expect(path.basename(file, '.java')).toBe(cls[1]);
    }
  });

  test('every classic script in www parses', () => {
    const files = walk(path.join(root, 'www', 'js'), '.js').filter((f) => !f.endsWith('.min.js'));
    const broken = [];
    for (const f of files) {
      try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
      } catch (e) {
        broken.push(`${path.relative(root, f)}: ${String(e.stderr).split('\n').find((l) => l.includes('Error')) || ''}`);
      }
    }
    expect(broken).toEqual([]);
  });

  test('API 37 target declares the local-network permission bridge', () => {
    expect(configXml).toContain('android-targetSdkVersion" value="37"');
    expect(configXml).toContain('android-compileSdkVersion" value="37"');
    const manifest = read('custom-plugins/cordova-plugin-network-tools/plugin.xml');
    const native = read('custom-plugins/cordova-plugin-network-tools/src/android/com/agentos/network/AgentOSNetworkToolsPlugin.java');
    const bridge = read('custom-plugins/cordova-plugin-network-tools/www/NetworkTools.js');
    expect(manifest).toContain('android.permission.ACCESS_LOCAL_NETWORK');
    expect(native).toContain('requestLocalNetworkPermission');
    expect(native).toContain('onRequestPermissionResult');
    expect(bridge).toContain('requestLocalNetworkPermission()');
  });
  test('Play rollout publishes config.xml application id and matching Cordova Android major', () => {
    const wf = read('.github/workflows/play-rollout.yml');
    const id = configXml.match(/<widget[^>]*\sid="([^"]+)"/)[1];
    expect(wf).toContain(`packageName: ${id}`);
    const major = JSON.parse(read('package.json')).devDependencies['cordova-android'].match(/\d+/)[0];
    expect(wf).toContain(`cordova platform add android@${major}`);
    expect(wf).not.toMatch(/platform add android@\d+[^\n]*\|\| true/);
  });
});
