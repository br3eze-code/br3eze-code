import fs from 'node:fs';
import path from 'node:path';

const registryPath = path.resolve(process.cwd(), 'docs/agentos-matrix-organization.json');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

describe('AgentOS matrix organization registry', () => {
  test('defines unique accountability cells with explicit ownership', () => {
    const registry = loadRegistry();
    const ids = registry.accountabilityCells.map((cell) => cell.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(registry.accountabilityCells.length).toBeGreaterThanOrEqual(12);
    expect(registry.accountabilityCells.every((cell) => cell.owns?.length > 0)).toBe(true);
  });

  test('requires explicit selection on user-facing multi-scope channels', () => {
    const registry = loadRegistry();
    const channels = Object.fromEntries(registry.channels.map((channel) => [channel.id, channel]));
    expect(channels.telegram.requiresExplicitSelection).toBe(true);
    expect(channels.whatsapp.requiresExplicitSelection).toBe(true);
    expect(channels.pwa.requiresExplicitSelection).toBe(true);
    expect(channels.cli.requiresExplicitSelection).toBe(true);
    expect(channels['edge-agent'].contextSource).toBe('enrolled-node-identity');
  });

  test('keeps fleet health polling independent of model execution', () => {
    const registry = loadRegistry();
    const poll = registry.executionClasses.find((item) => item.id === 'fleet-health-poll');
    const aggregate = registry.executionClasses.find((item) => item.id === 'site-aggregation');
    expect(poll.modelOnCriticalPath).toBe(false);
    expect(aggregate.modelOnCriticalPath).toBe(false);
    expect(poll.state).toEqual(expect.arrayContaining(['lease', 'snapshot', 'retry-budget']));
  });

  test('includes tenant and resource scope in the evidence contract', () => {
    const registry = loadRegistry();
    expect(registry.resourceHierarchy).toEqual(expect.arrayContaining(['tenant', 'project', 'meshGroup', 'site', 'node', 'user', 'session']));
    expect(registry.evidenceFields).toEqual(expect.arrayContaining(['traceId', 'tenantId', 'siteId', 'nodeId', 'capability', 'channel', 'idempotencyKey']));
  });
});
