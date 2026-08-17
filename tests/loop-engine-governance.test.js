import { LoopEngine, LOOP_STATES } from '../src/core/orchestration/loop-engine.js';

describe('LoopEngine governance limits', () => {
  test('pauses and resumes a work loop without losing tenant scope', async () => {
    const engine = new LoopEngine({ idFactory: () => 'loop-1' });
    const state = engine.createState({ workId: 'work-1', goal: 'await device approval', tenantId: 'tenant-a' });
    const waiting = await engine.run({ state, plan: async () => ({ type: 'wait', until: '2026-08-17T12:00:00.000Z', reason: 'approval pending' }), execute: async () => ({ success: true }), verify: async () => ({ accepted: true }) });
    expect(waiting).toMatchObject({ state: LOOP_STATES.WAIT, status: 'waiting', work: { tenantId: 'tenant-a' }, waitReason: 'approval pending' });
    expect(engine.resume(waiting).state).toBe(LOOP_STATES.PLANNING);
  });

  test('fails when the execution cost budget is exceeded', async () => {
    const engine = new LoopEngine({ idFactory: () => 'loop-2', limits: { maxCost: 1, maxIterations: 3 } });
    const state = engine.createState({ workId: 'work-2', goal: 'expensive action', tenantId: 'tenant-a' });
    const result = await engine.run({ state, plan: async () => ({ tool: 'expensive', input: {} }), execute: async () => ({ success: true, cost: 2 }), verify: async () => ({ accepted: true }) });
    expect(result).toMatchObject({ state: LOOP_STATES.FAILED, status: 'failed' });
    expect(result.blockers[0].code).toBe('COST_LIMIT');
  });
});
