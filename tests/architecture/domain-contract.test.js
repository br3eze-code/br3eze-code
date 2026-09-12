import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import BaseDomain from '../../src/domains/BaseDomain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/domains');

async function domainDirectories() {
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

describe('universal domain contract', () => {
  test('BaseDomain exposes the canonical lifecycle', () => {
    const domain = new BaseDomain();
    expect(domain.name).toBe('base');
    expect(typeof domain.registerTool).toBe('function');
    expect(typeof domain.getSkills).toBe('function');
    expect(typeof domain.getTools).toBe('function');
    expect(typeof domain.execute).toBe('function');
    expect(typeof domain.getCapabilities).toBe('function');
  });

  test('every domain exports a loadable implementation with the canonical surface', async () => {
    const failures = [];
    for (const name of await domainDirectories()) {
      const entry = path.join(root, name, 'index.js');
      try {
        const imported = await import(pathToFileURL(entry).href);
        const implementation = imported.default || imported.Domain || imported[`${name[0].toUpperCase()}${name.slice(1)}Domain`];
        const prototype = typeof implementation === 'function' ? implementation.prototype : implementation;
        const valid = Boolean(
          prototype &&
          (typeof prototype.getSkills === 'function' || typeof prototype.getTools === 'function') &&
          (typeof prototype.getCapabilities === 'function' || Array.isArray(prototype.capabilities))
        );
        if (!valid) failures.push(name);
      } catch (error) {
        failures.push(`${name}: ${error.message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
