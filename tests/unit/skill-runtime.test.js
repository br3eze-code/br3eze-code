import { test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createSkillRuntime, defineSkill, defineTool } from '../../src/runtime/index.js';

function weatherSkill() {
  return defineSkill({
    name: 'weather',
    tools: [defineTool({
      name: 'forecast',
      handler: async (args) => ({ place: args.place || 'unknown' }),
    })],
    match: (input) => String(input).includes('weather') ? { tool: 'forecast', args: { place: 'Harare' } } : null,
  });
}

test('skill runtime executes the first matching tool', async () => {
  const runtime = createSkillRuntime({ skills: [weatherSkill()] });
  const result = await runtime.run('weather please');
  assert.equal(result.ok, true);
  assert.equal(result.skill, 'weather');
  assert.deepEqual(result.result, { place: 'Harare' });
});

test('skill runtime denies a tool unless authorize allows it', async () => {
  const runtime = createSkillRuntime({
    skills: [weatherSkill()],
    authorize: async () => ({ allowed: false, reason: 'needs approval' }),
  });
  const result = await runtime.run('weather please');
  assert.deepEqual(result, {
    ok: false,
    reason: 'needs approval',
    skill: 'weather',
    tool: 'forecast',
  });
});

test('skill runtime reports no match and rejects a duplicate skill', async () => {
  const runtime = createSkillRuntime();
  assert.deepEqual(await runtime.run('hello'), { ok: false, reason: 'no_match' });
  runtime.use(weatherSkill());
  assert.throws(() => runtime.use(weatherSkill()), /already registered/);
});
