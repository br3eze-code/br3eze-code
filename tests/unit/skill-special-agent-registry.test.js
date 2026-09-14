import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import SkillRegistry from '../../src/core/SkillRegistry.js';
import specialAgentRegistry, { SpecialAgentRegistry } from '../../src/core/special-agent-registry.js';

describe('canonical skill registry', () => {
  it('supports the normalized manifest contract', () => {
    const registry = new SkillRegistry();
    registry.register({ name: 'example', version: '1.0.0', description: 'Example', permissions: [] }, {
      execute: async (tool, args) => ({ tool, args })
    });
    assert.equal(registry.has('example'), true);
    assert.equal(registry.count(), 1);
    assert.equal(registry.list()[0].name, 'example');
    assert.deepEqual(await registry.executeTool('example.echo', { ok: true }), { tool: 'echo', args: { ok: true } });
  });

  it('keeps legacy register(name, skill) compatible without another registry implementation', async () => {
    const registry = new SkillRegistry();
    registry.register('legacy', { description: 'Legacy', execute: async params => params });
    assert.deepEqual(await registry.execute('legacy', { value: 1 }), { value: 1 });
  });
});

describe('special-agent registry', () => {
  it('resolves all canonical professional profiles through one registry', () => {
    const registry = new SpecialAgentRegistry();
    const roles = registry.list().map(profile => profile.role);
    assert.ok(roles.includes('planner'));
    assert.ok(roles.includes('procurement'));
    assert.ok(roles.includes('qa'));
    assert.ok(roles.includes('br3ezeserviceagent'));
    assert.equal(registry.resolve({ professionalRole: 'quality-assurance' }).role, 'qa');
  });

  it('does not turn a role profile into permission by itself', () => {
    assert.equal(specialAgentRegistry.approvalRequired('engineer', 'device.mutation'), true);
    assert.equal(specialAgentRegistry.canPropose('engineer', 'device.mutation'), false);
  });
});
