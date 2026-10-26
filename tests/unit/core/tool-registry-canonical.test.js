import CanonicalRegistry from '../../../src/core/tool-registry.js';
import LegacyRegistryFacade, { ToolRegistry as FacadeRegistry } from '../../../src/core/ToolRegistry.js';
import { SpecialistToolRegistry } from '../../../src/core/specialists/SpecialistToolRegistry.js';
import { getTaskRegistry, TaskStatus } from '../../../src/core/taskRegistry.js';


function executionContext(action, extra = {}) {
  const tenantId = 'tenant-test';
  const userId = 'user-test';
  const task = getTaskRegistry().create('test tool execution', {
    action,
    owner: { userId },
    context: { tenantId, userId, ...extra },
    input: {},
    requiresExecutionApproval: false,
  });
  getTaskRegistry().setStatus(task.taskId, TaskStatus.RUNNING);
  return { tenantId, userId, taskId: task.taskId, action, phase: 'execute', ...extra };
}

describe('ToolRegistry architecture', () => {
  test('PascalCase facade and lowercase module expose the same canonical class', () => {
    expect(FacadeRegistry).toBe(CanonicalRegistry);
    expect(LegacyRegistryFacade).toBeInstanceOf(CanonicalRegistry);
  });

  test('canonical registry registers and executes an object-argument tool', async () => {
    const registry = new CanonicalRegistry();
    registry.register('test.echo', { description: 'Echo', execute: async (args) => args.value });
    await expect(registry.execute('test.echo', { value: 'ok' }, executionContext('test.echo'))).resolves.toBe('ok');
    expect(registry.getTool('test.echo').fullName).toBe('test.echo');
  });

  test('domain registration preserves BaseDomain positional execution', async () => {
    const registry = new CanonicalRegistry();
    registry.registerDomain('demo', [
      { name: 'add', execute: (a, b) => a + b },
      { name: 'context', passContext: true, execute: (value, ctx) => `${value}:${ctx.requestId}` },
    ]);
    await expect(registry.execute('demo.add', [2, 3], executionContext('demo.add'))).resolves.toBe(5);
    await expect(registry.execute('demo.context', ['ok'], executionContext('demo.context', { requestId: 'r1' }))).resolves.toBe('ok:r1');
  });

  test('specialist ownership index is distinct from global execution registry', () => {
    const registry = new SpecialistToolRegistry({
      skills: [{ name: 'test', tools: [{ name: 'echo', specialist: 'support' }] }],
    });
    expect(registry.toolsForSpecialist({ role: 'support' })).toHaveLength(1);
    expect(registry).not.toBeInstanceOf(CanonicalRegistry);
  });
});
