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

  test('ping() returns a reachable-host shape with a default target', async () => {
    const result = await domain.execute({ tool: 'ping', params: undefined });
    expect(result).toMatchObject({ host: '8.8.8.8', status: 'reachable', packetLoss: '0%' });
    expect(result.latency).toMatch(/^\d+ms$/);
  });

  test('ping() honors an explicit host', async () => {
    const result = await domain.execute({ tool: 'ping', params: '1.1.1.1' });
    expect(result.host).toBe('1.1.1.1');
  });

  test('monitor() returns interface stats with a default interface', async () => {
    const result = await domain.execute({ tool: 'monitor', params: undefined });
    expect(result).toMatchObject({ interface: 'ether1', status: 'up' });
    expect(result.rx).toMatch(/Mbps$/);
    expect(result.tx).toMatch(/Mbps$/);
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

  test('processes() returns a list of task entries with id and status', async () => {
    const result = await domain.execute({ tool: 'processes', params: undefined });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    for (const proc of result) {
      expect(proc).toHaveProperty('id');
      expect(proc).toHaveProperty('status');
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
