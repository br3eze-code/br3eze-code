import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRegistry as SpecialistToolProjection } from '../../src/core/specialists/ToolRegistry.js';
import { ToolRegistry } from '../../src/core/ToolRegistry.js';

test('specialist tool registry is a projection over the canonical registry', () => {
  const registry = new ToolRegistry();
  registry.register('commerce.catalog.list', {
    description: 'List catalog', specialist: 'Procurement', execute: async () => []
  });
  registry.register('network.status', {
    description: 'Network status', specialist: 'Engineer', execute: async () => ({})
  });

  const projection = new SpecialistToolProjection({ registry });
  assert.equal(projection.getTool('commerce.catalog.list').specialist, 'Procurement');
  assert.equal(projection.listTools().length, 2);
  assert.deepEqual(
    projection.toolsForSpecialist({ role: 'Procurement' }).map((tool) => tool.fullName),
    ['commerce.catalog.list']
  );
});

test('specialist projection does not own registration state', () => {
  const registry = new ToolRegistry();
  const projection = new SpecialistToolProjection({ registry });
  assert.equal(typeof projection.registerSkill, 'undefined');
  assert.equal(typeof projection.registerTool, 'undefined');
});
