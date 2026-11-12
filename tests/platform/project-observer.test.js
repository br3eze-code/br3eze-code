import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ProjectObserver } from '../../src/core/observation/project-observer.js';

test('ProjectObserver emits normalized runtime events without raw prompt/output data', () => {
  const runtime = new EventEmitter();
  const observer = new ProjectObserver({ runtime, projectId: 'proj-demo' }).start();
  const received = [];
  observer.on('event', (event) => received.push(event));

  runtime.emit('turn', {
    prompt: 'PRIVATE_PROMPT_DO_NOT_STORE',
    output: 'PRIVATE_MODEL_OUTPUT_DO_NOT_STORE',
    stopReason: 'completed',
    timestamp: '2026-11-11T10:00:00.000Z',
    matchedTools: ['tool.safe'],
  });

  assert.equal(received.length, 1);
  assert.equal(received[0].source, 'agent-runtime');
  assert.equal(received[0].projectId, 'proj-demo');
  assert.equal(received[0].summary, 'Agent turn completed');
  assert.equal(received[0].redactionApplied, true);
  assert.equal(JSON.stringify(observer.getEvents()).includes('PRIVATE_PROMPT_DO_NOT_STORE'), false);
  assert.equal(JSON.stringify(observer.getEvents()).includes('PRIVATE_MODEL_OUTPUT_DO_NOT_STORE'), false);
  assert.equal(observer.getStatus().rawPayloadsStored, false);
  observer.stop();
});

test('ProjectObserver keeps bounded history and exposes stable freshness metadata', () => {
  const runtime = new EventEmitter();
  const observer = new ProjectObserver({ runtime, historyLimit: 2 }).start();
  runtime.emit('session:created', { sessionId: 's1', prompt: 'secret one' });
  runtime.emit('session:created', { sessionId: 's2', prompt: 'secret two' });
  runtime.emit('session:created', { sessionId: 's3', prompt: 'secret three' });

  assert.equal(observer.getEvents().length, 2);
  assert.equal(observer.getStatus().eventCount, 2);
  assert.ok(observer.getStatus().lastEventAt);
  assert.equal(observer.getEvents()[0].evidenceRef, 's2');
  observer.stop();
});

test('ProjectObserver stop detaches runtime listeners and start is idempotent', () => {
  const runtime = new EventEmitter();
  const observer = new ProjectObserver({ runtime });
  observer.start().start();
  assert.equal(runtime.listenerCount('turn'), 1);

  runtime.emit('turn', { stopReason: 'failed', output: 'secret' });
  assert.equal(observer.getEvents().length, 1);
  observer.stop();
  runtime.emit('turn', { stopReason: 'completed' });
  assert.equal(observer.getEvents().length, 1);
  assert.equal(observer.getStatus().connected, false);
});

test('ProjectObserver filters event history by authenticated user scope', () => {
  const runtime = new EventEmitter();
  const observer = new ProjectObserver({ runtime }).start();
  runtime.emit('task:dispatched', { taskId: 't1', context: { userId: 'user-a' }, wbs: { id: 'WBS-1' } });
  runtime.emit('task:dispatched', { taskId: 't2', context: { userId: 'user-b' }, wbs: { id: 'WBS-2' } });

  assert.equal(observer.getEvents({ userId: 'user-a' }).length, 1);
  assert.equal(observer.getEvents({ userId: 'user-a' })[0].evidenceRef, 't1');
  assert.equal(observer.getEvents({ userId: 'user-a' })[0].activityId, 'WBS-1');
  assert.equal(observer.getEvents({ userId: 'user-c' }).length, 0);
  observer.stop();
});
