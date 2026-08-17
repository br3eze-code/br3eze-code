import fs from 'node:fs';
import path from 'node:path';
import { AgentMatrixError, createAgentMatrixRegistry } from '../src/core/agent-matrix-registry.js';

const registry = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'docs/agentos-matrix-organization.json'), 'utf8'));
const matrix = createAgentMatrixRegistry(registry);
const base = {
  accountabilityCellId: 'fleet-operations',
  capability: 'health.read',
  channelId: 'telegram',
  scope: { tenantId: 'tenant-1', projectId: 'project-1', meshGroupId: 'mesh-1', siteIds: ['site-1'], nodeIds: ['node-1'] },
  traceId: 'trace-1',
  actorId: 'principal-1'
};

describe('AgentMatrixRegistry', () => {
  test('resolves a tenant/site/node health intersection without a model dependency', () => {
    const result = matrix.resolve(base);
    expect(result.capabilityFamily).toBe('fleet');
    expect(result.scope.tenantId).toBe('tenant-1');
    expect(result.scope.siteIds).toEqual(['site-1']);
    expect(result.modelOnCriticalPath).toBe(false);
  });

  test('rejects a node scope without an explicit site scope', () => {
    expect(() => matrix.resolve({ ...base, scope: { tenantId: 'tenant-1', nodeIds: ['node-1'] } })).toThrow(
      expect.objectContaining({ code: 'MATRIX_SCOPE_INVALID' })
    );
  });

  test('requires approval for mutations owned by an accountability cell', () => {
    const mutation = matrix.resolve({
      ...base,
      accountabilityCellId: 'engineer',
      capability: 'device.mutation',
      scope: { tenantId: 'tenant-1', siteIds: ['site-1'], nodeIds: ['node-1'] }
    });
    expect(() => matrix.assertMutation(mutation)).toThrow(
      expect.objectContaining({ code: 'MATRIX_APPROVAL_REQUIRED' })
    );
    expect(matrix.assertMutation({ ...mutation, approvalId: 'approval-1' }).approvalId).toBe('approval-1');
  });

  test('rejects unknown capabilities and missing actor identity', () => {
    expect(() => matrix.resolve({ ...base, capability: 'router.magic' })).toThrow(
      expect.objectContaining({ code: 'MATRIX_CAPABILITY_UNKNOWN' })
    );
    expect(() => matrix.resolve({ ...base, actorId: '' })).toThrow(AgentMatrixError);
  });
});
