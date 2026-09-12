import CanonicalRegistry from '../../../src/core/tool-registry.js';
import LegacyRegistryFacade, { ToolRegistry as FacadeRegistry } from '../../../src/core/ToolRegistry.js';
import { SpecialistToolRegistry } from '../../../src/core/specialists/SpecialistToolRegistry.js';

describe('ToolRegistry architecture', () => {
  test('PascalCase facade and lowercase module expose the same canonical class', () => {
    expect(FacadeRegistry).toBe(CanonicalRegistry);
    expect(LegacyRegistryFacade).toBeInstanceOf(CanonicalRegistry);
  });

  test('canonical registry registers and executes a tool', async () => {
    const registry = new CanonicalRegistry();
    registry.register('test.echo', { description: 'Echo', execute: async (args) => args.value });
    await expect(registry.execute('test.echo', { value: 'ok' })).resolves.toBe('ok');
    expect(registry.getTool('test.echo').fullName).toBe('test.echo');
  });

  test('specialist ownership index is distinct from global execution registry', () => {
    const registry = new SpecialistToolRegistry({
      skills: [{ name: 'test', tools: [{ name: 'echo', specialist: 'support' }] }],
    });
    expect(registry.toolsForSpecialist({ role: 'support' })).toHaveLength(1);
    expect(registry).not.toBeInstanceOf(CanonicalRegistry);
  });
});
