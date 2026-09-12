import { describe, expect, test } from '@jest/globals';
import { describeCapability, checkCapabilityBoundary } from '../../src/core/capability-boundary.js';
import { TaskRegistry, TaskPhase } from '../../src/core/taskRegistry.js';

describe('capability and task execution boundary', () => {
  test('requires tenant and actor scope', () => {
    const capability = describeCapability({ id: 'purchase.order', phase: 'execute', risk: 'high', requiresApproval: true, permissions: ['purchase.order'] });
    expect(checkCapabilityBoundary(capability, {}, { phase: 'execute' }).allowed).toBe(false);
    expect(checkCapabilityBoundary(capability, { tenantId: 't1', userId: 'u1', capabilities: ['purchase.order'] }, { phase: 'execute' }).errors).toContain('approval_required');
  });

  test('financial/procurement mutation cannot execute before plan and draft', () => {
    const tasks = new TaskRegistry();
    const task = tasks.create('buy equipment', { action: 'purchase.order', context: { tenantId: 't1', userId: 'u1', domainId: 'commerce' } });
    expect(task.execution.approvalRequired).toBe(true);
    expect(() => tasks.beginExecution(task.taskId)).toThrow('completed plan and draft');
    tasks.markPlanReady(task.taskId, { requirements: ['item', 'quantity', 'budget'] });
    expect(() => tasks.beginExecution(task.taskId)).toThrow('completed plan and draft');
    tasks.markDraftReady(task.taskId, { supplierComparison: [], recommendation: null });
    expect(() => tasks.beginExecution(task.taskId)).toThrow('approval');
    tasks.approveExecution(task.taskId, 'apr_test');
    expect(tasks.beginExecution(task.taskId).execution.phase).toBe(TaskPhase.EXECUTE);
  });

  test('read-only task does not require approval', () => {
    const tasks = new TaskRegistry();
    const task = tasks.create('compare quotes', { action: 'quote.compare', context: { tenantId: 't1', userId: 'u1' } });
    expect(task.execution.approvalRequired).toBe(false);
    tasks.markPlanReady(task.taskId, { criteria: ['price', 'delivery'] });
    tasks.markDraftReady(task.taskId, { comparison: [] });
    expect(tasks.beginExecution(task.taskId).status).toBe('running');
  });
});
