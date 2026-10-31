import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from '@jest/globals';
import { FileTaskStore } from '../../src/core/file-task-store.js';
import { TaskRegistry, TaskStatus } from '../../src/core/taskRegistry.js';

const tempDirs = [];
function makeStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentos-task-store-'));
  tempDirs.push(directory);
  return new FileTaskStore({ directory });
}
const context = { tenantId: 'tenant-test', userId: 'user-test' };

afterEach(() => {
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('FileTaskStore', () => {
  test('persists task records across store instances', () => {
    const first = makeStore();
    const registry = new TaskRegistry({ store: first });
    const task = registry.create('survive restart', { context });

    const restarted = new TaskRegistry({ store: new FileTaskStore({ directory: first.directory }) });
    expect(restarted.get(task.taskId)).toMatchObject({
      taskId: task.taskId,
      prompt: 'survive restart',
      scope: { tenantId: 'tenant-test', userId: 'user-test' },
    });
  });

  test('updates are durable and status filters work after restart', () => {
    const store = makeStore();
    const registry = new TaskRegistry({ store });
    const task = registry.create('durable status', { context });
    registry.setStatus(task.taskId, TaskStatus.COMPLETED);

    const restarted = new TaskRegistry({ store: new FileTaskStore({ directory: store.directory }) });
    expect(restarted.list(TaskStatus.COMPLETED)).toHaveLength(1);
    expect(restarted.get(task.taskId).status).toBe(TaskStatus.COMPLETED);
  });

  test('recovers running tasks as interrupted instead of replaying them', () => {
    const store = makeStore();
    const registry = new TaskRegistry({ store });
    const task = registry.create('do not replay blindly', { context });
    registry.setStatus(task.taskId, TaskStatus.RUNNING);

    const restarted = new TaskRegistry({ store: new FileTaskStore({ directory: store.directory }) });
    expect(restarted.recoverInterrupted()).toBe(1);
    expect(restarted.get(task.taskId).status).toBe(TaskStatus.FAILED);
    expect(restarted.get(task.taskId).recovery).toMatchObject({ state: 'interrupted', replayed: false });
    expect(restarted.get(task.taskId).messages.at(-1).content).toMatch(/automatic replay is disabled/);
  });

  test('rejects unsafe task identifiers', () => {
    const store = makeStore();
    expect(() => store.get('../secrets')).toThrow(/Invalid task id/);
  });
});
