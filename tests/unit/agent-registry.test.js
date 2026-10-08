import { describe, expect, test } from '@jest/globals';
import { AgentRegistry } from '../../src/core/agent-registry.js';

describe('AgentRegistry', () => {
  test('normalizes profile and specialist definitions behind one identity', () => {
    const registry = new AgentRegistry();
    const agent = registry.register({
      id: 'inventory-specialist',
      role: 'Inventory Specialist',
      label: 'Inventory Specialist',
      capabilities: ['inventory.read'],
      approvalRequired: ['inventory.write'],
      skills: ['inventory'],
      tools: ['inventory.search'],
      ticketTypes: ['inventory-inquiry'],
      handoffsTo: ['orders'],
    });

    expect(agent.role).toBe('inventoryspecialist');
    expect(registry.get('inventory-specialist')).toBe(agent);
    expect(registry.get('Inventory Specialist')).toBe(agent);
    expect(registry.resolve({ agentRole: 'Inventory Specialist' })).toBe(agent);
    expect(registry.canPropose(agent.id, 'inventory.read')).toBe(true);
    expect(registry.approvalRequired(agent.role, 'inventory.write.adjust')).toBe(true);
    expect(registry.canHandle(agent.role, 'inventory-inquiry')).toBe(true);
  });

  test('supports profile-only agents and immutable capability metadata', () => {
    const registry = new AgentRegistry();
    const agent = registry.register({
      role: 'planner',
      capabilities: ['plan.create'],
      approvalRequired: ['plan.execute_mutation'],
      domains: ['*'],
    });

    expect(registry.has('planner')).toBe(true);
    expect(registry.list()).toHaveLength(1);
    expect(Object.isFrozen(agent)).toBe(true);
    expect(Object.isFrozen(agent.capabilities)).toBe(true);
  });

  test('rejects duplicate role or id', () => {
    const registry = new AgentRegistry();
    registry.register({ role: 'engineer' });
    expect(() => registry.register({ id: 'engineer-agent', role: 'other' })).toThrow(/already registered/);
  });
});
