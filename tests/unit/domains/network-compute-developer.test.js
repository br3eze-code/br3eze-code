import NetworkDomain from '../../../src/domains/network/index.js';
import ComputeDomain from '../../../src/domains/compute/index.js';
import DeveloperDomain from '../../../src/domains/developer/index.js';

describe('NetworkDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new NetworkDomain();
  });

  test('registers ping and monitor tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['monitor', 'ping']);
  });

  test('ping() returns a host and a platform-independent result shape', async () => {
    const result = await domain.execute({ tool: 'ping', params: undefined });
    expect(result.host).toBe('8.8.8.8');
    expect(['reachable', 'unreachable']).toContain(result.status);
    expect(typeof result.latencyMs).toBe('number');
  });

  test('ping() honors an explicit host without requiring external network access', async () => {
    const result = await domain.execute({ tool: 'ping', params: '1.1.1.1' });
    expect(result.host).toBe('1.1.1.1');
    expect(['reachable', 'unreachable']).toContain(result.status);
  });

  test('monitor() returns interface details from the host operating system', async () => {
    const result = await domain.execute({ tool: 'monitor', params: undefined });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const iface of result) {
      expect(iface).toHaveProperty('interface');
      expect(typeof iface.exists).toBe('boolean');
      expect(['up', 'down']).toContain(iface.status);
      expect(Array.isArray(iface.addresses)).toBe(true);
    }
  });
});

describe('ComputeDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new ComputeDomain();
  });

  test('registers stats and processes tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['processes', 'stats']);
  });

  test('stats() returns cpu and memory usage in the expected shape', async () => {
    const result = await domain.execute({ tool: 'stats', params: undefined });
    expect(result.cpu).toMatch(/^\d+(\.\d+)?%$/);
    expect(result.memory.heapUsed).toMatch(/MB$/);
    expect(result.memory.heapTotal).toMatch(/MB$/);
    expect(result.memory.rss).toMatch(/MB$/);
  });

  test('processes() returns runtime process information', async () => {
    const result = await domain.execute({ tool: 'processes', params: undefined });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const proc of result) {
      expect(proc).toHaveProperty('pid');
      expect(proc).toHaveProperty('status', 'running');
      expect(proc).toHaveProperty('platform');
      expect(proc).toHaveProperty('arch');
    }
  });
});

describe('DeveloperDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new DeveloperDomain();
  });

  test('registers codegen and test tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['codegen', 'test']);
  });

  test('codegen() echoes the prompt back in its stub response', async () => {
    const result = await domain.execute({ tool: 'codegen', params: 'a REST endpoint' });
    expect(result).toContain('a REST endpoint');
  });

  test('test() echoes the suite name back in its stub response', async () => {
    const result = await domain.execute({ tool: 'test', params: 'unit' });
    expect(result).toContain('unit');
  });
});
