import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';
import { TaskRegistry, TaskPhase } from '../../src/core/taskRegistry.js';
import { describeCapability, checkCapabilityBoundary } from '../../src/core/capability-boundary.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const kernelFiles = [
  'src/core/kernel/index.js',
  'src/core/capability-boundary.js',
  'src/core/orchestrator.js',
  'src/core/taskRegistry.js'
];
const forbidden = /(?:mikrotik|routeros|starlink|wifi|innbucks|ecocash|voucher|procurement|accounting|payment|commerce)/i;

describe('AgentOS kernel boundary', () => {
  test('kernel implementation contains no domain/vendor coupling', () => {
    const violations = [];
    for (const relative of kernelFiles) {
      const source = fs.readFileSync(path.join(root, relative), 'utf8');
      if (forbidden.test(source)) violations.push(relative);
    }
    expect(violations).toEqual([]);
  });

  test('capability execution requires scope and actor', () => {
    const capability = describeCapability({ id: 'example.mutate', phase: 'execute', risk: 'medium', permissions: ['example.write'] });
    expect(checkCapabilityBoundary(capability, {}, { phase: 'execute' }).allowed).toBe(false);
    expect(checkCapabilityBoundary(capability, { tenantId: 't1', userId: 'u1', capabilities: ['example.write'] }, { phase: 'execute' }).errors).toContain('approval_required');
  });

  test('tasks cannot execute before plan, draft and approval', () => {
    const registry = new TaskRegistry();
    const task = registry.create('perform a change', { context: { tenantId: 't1', userId: 'u1', domainId: 'd1', siteId: 's1' }, requiresExecutionApproval: true });
    expect(task.execution.phase).toBe(TaskPhase.PLAN);
    expect(() => registry.beginExecution(task.taskId)).toThrow(/plan and draft|approved/i);
    registry.markPlanReady(task.taskId, { steps: ['inspect', 'prepare'] });
    registry.markDraftReady(task.taskId, { proposedChange: 'example' });
    expect(() => registry.beginExecution(task.taskId)).toThrow(/approval/i);
    registry.approveExecution(task.taskId, 'approval-test');
    const running = registry.beginExecution(task.taskId);
    expect(running.status).toBe('running');
    expect(running.execution.phase).toBe(TaskPhase.EXECUTE);
  });
});
