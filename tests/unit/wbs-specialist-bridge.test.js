import { describe, expect, test } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { TaskRegistry, TaskStatus } from '../../src/core/taskRegistry.js';
import {
  decorateWorkPackage,
  instantiateRoutedWorkPackages,
  resolveSpecialistForWorkPackage,
  resolveEventTask,
  attachWbsEventTaskBridge,
} from '../../src/core/wbs-specialist-bridge.js';

describe('WBS specialist bridge', () => {
  test('routes commerce WBS packages to the canonical specialist and skill', () => {
    const routed = decorateWorkPackage({
      wbsId: 'WP-VO-001',
      agentRole: 'voucher',
      title: 'Issue voucher',
      status: 'ready',
    });
    expect(routed).toMatchObject({
      specialistId: 'voucher-specialist',
      skillId: 'voucher',
      routing: { specialistId: 'voucher-specialist', skillId: 'voucher' },
    });
  });

  test('instantiates existing WBS packages without breaking their dependencies', () => {
    const packages = instantiateRoutedWorkPackages('procurement', { tenantId: 'tenant-a', projectId: 'p-1' });
    expect(packages.length).toBeGreaterThan(0);
    expect(packages[0]).toMatchObject({
      agentRole: 'procurement',
      specialistId: 'procurement-specialist',
      skillId: 'procurement',
      tenantId: 'tenant-a',
      projectId: 'p-1',
    });
  });

  test('resolves voucher events into specialist tasks', () => {
    expect(resolveEventTask('voucher.redeemed', { tenantId: 'tenant-a' })).toMatchObject({
      ticketType: 'voucher-redemption',
      action: 'voucher.redeem',
      specialistId: 'voucher-specialist',
      skillId: 'voucher',
    });
  });

  test('creates a scoped TaskRegistry task from an event', () => {
    const eventBus = new EventEmitter();
    const taskRegistry = new TaskRegistry();
    const detach = attachWbsEventTaskBridge({ eventBus, taskRegistry });
    eventBus.emit('voucher.redeemed', {
      tenantId: 'tenant-a',
      projectId: 'p-1',
      userId: 'u-1',
      voucherId: 'v-1',
      executionId: 'exe-1',
    });
    detach();

    const tasks = taskRegistry.list();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      status: TaskStatus.CREATED,
      teamId: 'voucher-specialist',
      action: 'voucher.redeem',
      scope: { tenantId: 'tenant-a', userId: 'u-1' },
      routing: { specialistId: 'voucher-specialist', skillId: 'voucher', ticketType: 'voucher-redemption' },
      event: { name: 'voucher.redeemed', workId: 'exe-1' },
    });
  });
});
