import { CORE_ENTITY_TYPES, DomainAdapterRegistry, assertDomainAdapter } from '../../src/core/domain-kernel.js';

describe('domain-agnostic AgentOS kernel', () => {
  test('defines only generic control-plane entities', () => {
    expect(CORE_ENTITY_TYPES).toContain('work');
    expect(CORE_ENTITY_TYPES).toContain('evidence');
    expect(CORE_ENTITY_TYPES).not.toContain('mikrotik');
    expect(CORE_ENTITY_TYPES).not.toContain('stripe');
    expect(CORE_ENTITY_TYPES).not.toContain('github');
  });

  test('runs with no domain adapters registered', () => {
    const registry = new DomainAdapterRegistry();
    expect(registry.list()).toEqual([]);
  });

  test('registers and executes a synthetic domain adapter with scoped context', async () => {
    const registry = new DomainAdapterRegistry();
    const calls = [];
    registry.register({
      type: 'example.resource',
      version: '1.0.0',
      capabilities: [{ name: 'resource.inspect', inputSchema: { type: 'object' } }],
      execute: async request => {
        calls.push(request);
        return { status: 'verified', value: request.input.value };
      }
    });
    await expect(registry.execute({
      adapterType: 'example.resource',
      capability: 'resource.inspect',
      input: { value: 42 },
      context: { tenantId: 'tenant-a', workId: 'work-a', actionId: 'action-a' }
    })).resolves.toEqual({ status: 'verified', value: 42 });
    expect(calls[0].context.tenantId).toBe('tenant-a');
  });

  test('rejects unscoped adapter execution and malformed adapters', async () => {
    expect(() => assertDomainAdapter({ type: 'example', version: '1.0.0', capabilities: [], execute() {} })).toThrow('non-empty array');
    const registry = new DomainAdapterRegistry();
    registry.register({ type: 'example.resource', version: '1.0.0', capabilities: [{ name: 'inspect', inputSchema: {} }], execute() {} });
    await expect(registry.execute({ adapterType: 'example.resource', capability: 'inspect', input: {}, context: { tenantId: 'tenant-a' } })).rejects.toMatchObject({ code: 'EXECUTION_CONTEXT_REQUIRED' });
  });
});
