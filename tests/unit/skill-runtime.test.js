import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createSkillRuntime, defineSkill, defineTool } from '../../src/runtime/index.js';

function weatherSkill() {
  return defineSkill({
    name: 'weather',
    tools: [defineTool({
      name: 'forecast',
      handler: async () => {
        throw new Error('skill handler must not bypass the host executor');
      },
    })],
    match: (input) => String(input).includes('weather')
      ? { tool: 'forecast', args: { place: 'Harare' } }
      : null,
  });
}

test('skill runtime delegates approved work to the host executor', async () => {
  const runtime = createSkillRuntime({
    skills: [weatherSkill()],
    authorize: async ({ tool }) => ({ allowed: tool.name === 'forecast' }),
    execute: async ({ tool, args, context }) => ({
      tool: tool.name,
      place: args.place,
      userId: context.userId,
    }),
  });
  const result = await runtime.run('weather please', { userId: 'user-1' });
  assert.equal(result.ok, true);
  assert.equal(result.skill, 'weather');
  assert.deepEqual(result.result, {
    tool: 'forecast',
    place: 'Harare',
    userId: 'user-1',
  });
});

test('skill runtime never executes when authorization denies', async () => {
  let executions = 0;
  const runtime = createSkillRuntime({
    skills: [weatherSkill()],
    authorize: async () => ({ allowed: false, reason: 'needs approval' }),
    execute: async () => {
      executions += 1;
      return 'should not run';
    },
  });
  const result = await runtime.run('weather please');
  assert.deepEqual(result, {
    ok: false,
    reason: 'needs approval',
    skill: 'weather',
    tool: 'forecast',
  });
  assert.equal(executions, 0);
});

test('skill runtime requires authorization and a canonical host executor', () => {
  assert.throws(
    () => createSkillRuntime({ skills: [weatherSkill()], execute: async () => {} }),
    /authorize is required/,
  );
  assert.throws(
    () => createSkillRuntime({ skills: [weatherSkill()], authorize: async () => ({ allowed: true }) }),
    /execute is required/,
  );
});

test('skill runtime reports no match and rejects a duplicate skill', async () => {
  const runtime = createSkillRuntime({
    authorize: async () => ({ allowed: true }),
    execute: async () => null,
  });
  assert.deepEqual(await runtime.run('hello'), { ok: false, reason: 'no_match' });
  runtime.use(weatherSkill());
  assert.throws(() => runtime.use(weatherSkill()), /already registered/);
});
