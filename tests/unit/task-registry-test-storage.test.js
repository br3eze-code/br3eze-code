import { afterEach, describe, expect, test } from '@jest/globals';
import { getTaskRegistry } from '../../src/core/taskRegistry.js';

const originalNodeEnv = process.env.NODE_ENV;
const originalStoreDir = process.env.AGENTOS_TASK_STORE_DIR;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalStoreDir === undefined) delete process.env.AGENTOS_TASK_STORE_DIR;
  else process.env.AGENTOS_TASK_STORE_DIR = originalStoreDir;
  getTaskRegistry({ reset: true, store: null });
});

describe('task registry host storage mode', () => {
  test('does not create a persistent file store by default in tests', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AGENTOS_TASK_STORE_DIR;
    const registry = getTaskRegistry({ reset: true });
    expect(registry.store).toBeNull();
  });

  test('allows an explicit store in tests', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.AGENTOS_TASK_STORE_DIR;
    const store = { list: () => [], save: () => null };
    const registry = getTaskRegistry({ reset: true, store });
    expect(registry.store).toBe(store);
  });

  test('uses configured local persistence outside tests', () => {
    process.env.NODE_ENV = 'production';
    const directory = '/tmp/agentos-test-task-store';
    process.env.AGENTOS_TASK_STORE_DIR = directory;
    const registry = getTaskRegistry({ reset: true });
    expect(registry.store.directory).toBe(directory);
  });
});
