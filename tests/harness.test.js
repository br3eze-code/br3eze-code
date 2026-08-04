/**
 * tests/harness.test.js
 *
 * Smoke tests for AgentHarness — run without any external services.
 */

import { AgentHarness } from '../src/harness/AgentHarness.js';
import registry from '../src/core/ToolRegistry.js';
import { ToolRegistry } from '../src/core/ToolRegistry.js';
import r from '../src/core/tool-registry.js';
import BaseDomain from '../src/domains/BaseDomain.js';

// ── Minimal domain adapter (no external deps) ─────────────────────────────
const mockDomain = {
  name: 'mock',
  description: 'Test domain for unit tests',
  capabilities: ['ping', 'echo'],

  getCapabilities() { return this.capabilities; },

  getSkills() {
    return [
      {
        name: 'echo',
        description: 'Echo params back',
        parameters: { message: { type: 'string' } },
        risk: 'low',
        execute: async (params) => ({ echo: params.message || 'hello' }),
      },
      {
        name: 'add',
        description: 'Add two numbers',
        parameters: { a: { type: 'number' }, b: { type: 'number' } },
        risk: 'low',
        execute: async ({ a = 0, b = 0 } = {}) => ({ result: a + b }),
      },
    ];
  },

  getTools() {
    const skills = this.getSkills();
    const out = {};
    skills.forEach((s) => {
      out[`mock.${s.name}`] = {
        description: s.description,
        parameters:  s.parameters,
        risk:        s.risk,
        execute:     (ctx, params) => s.execute(params || ctx),
      };
    });
    return out;
  },

  async execute(ctx) {
    const skill = this.getSkills().find((s) => s.name === ctx.tool);
    if (!skill) throw new Error(`mock: unknown tool "${ctx.tool}"`);
    return skill.execute(ctx.params || {});
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────
describe('AgentHarness', () => {
  let harness;

  beforeEach(() => {
    harness = AgentHarness.create({ id: 'test-agent' });
    harness.useDomain(mockDomain);
  });

  afterEach(async () => {
    await harness.stop();
  });

  test('creates with id', () => {
    expect(harness.id).toBe('test-agent');
  });

  test('registers a domain', () => {
    expect(harness._domains.has('mock')).toBe(true);
  });

  test('starts successfully', async () => {
    await harness.start();
    expect(harness._started).toBe(true);
  });

  test('getManifest() returns domain list', async () => {
    await harness.start();
    const manifest = harness.getManifest();
    expect(manifest.id).toBe('test-agent');
    expect(manifest.domains).toContain('mock');
  });

  test('status() returns expected shape', async () => {
    await harness.start();
    const s = harness.status();
    expect(s.started).toBe(true);
    expect(s.domains).toContain('mock');
  });

  test('AgentHarness.create() factory works', () => {
    const h = AgentHarness.create({ id: 'factory-test' });
    expect(h).toBeInstanceOf(AgentHarness);
    expect(h.id).toBe('factory-test');
  });

  test('rejects invalid adapter (no name)', () => {
    expect(() => harness.useDomain({ execute: async () => {}, getCapabilities: () => [] }))
      .toThrow(/name/i);
  });

  test('rejects adapter without execute or getSkills', () => {
    expect(() => harness.useDomain({ name: 'bad', getCapabilities: () => [] }))
      .toThrow(/execute|getSkills/i);
  });

  test('rejects adapter without getCapabilities', () => {
    expect(() => harness.useDomain({ name: 'bad2', execute: async () => {} }))
      .toThrow(/getCapabilities/i);
  });

  test('emits domain:registered event', () => {
    const h = AgentHarness.create({ id: 'event-test' });
    const events = [];
    h.on('domain:registered', (e) => events.push(e));
    h.useDomain(mockDomain);
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('mock');
  });
});

describe('ToolRegistry integration', () => {
  test('ToolRegistry singleton is importable', () => {
    expect(typeof registry.registerDomain).toBe('function');
    expect(typeof registry.execute).toBe('function');
    expect(typeof registry.getManifest).toBe('function');
  });

  test('ToolRegistry class is accessible', () => {
    expect(typeof ToolRegistry).toBe('function');
    const r = new ToolRegistry();
    expect(r).toBeInstanceOf(ToolRegistry);
  });

  test('tool-registry.js class is accessible', () => {
    expect(typeof r).toBe('function');
    const inst = new r();
    expect(typeof inst.execute).toBe('function');
  });
});

describe('BaseDomain', () => {

  test('registerTool + getSkills', () => {
    const d = new BaseDomain();
    d.name = 'test';
    d.registerTool({ name: 'noop', execute: async () => null });
    expect(d.getSkills()).toHaveLength(1);
  });

  test('getTools() returns namespaced map', () => {
    const d = new BaseDomain();
    d.name = 'myDomain';
    d.registerTool({ name: 'doit', execute: async (p) => p });
    const tools = d.getTools();
    expect(tools['myDomain.doit']).toBeDefined();
  });

  test('execute() dispatches by tool name', async () => {
    const d = new BaseDomain();
    d.name = 'x';
    d.registerTool({ name: 'compute', execute: async ({ v } = {}) => ({ v: v * 2 }) });
    const result = await d.execute({ tool: 'compute', params: { v: 5 } });
    expect(result.v).toBe(10);
  });
});
