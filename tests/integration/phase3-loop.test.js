import { LoopEngine } from '../../src/core/orchestration/loop-engine.js';

describe('Phase 3 bounded orchestration loop', () => {
  test('completes the order-create and inventory-reserve golden flow from evidence', async () => {
    const engine = new LoopEngine({ idFactory: () => 'loop_golden', limits: { maxIterations: 4, maxToolCalls: 4 } });
    const state = engine.createState({
      workId: 'COM-1042', taskId: 'TASK-1042', tenantId: 'tenant-1', specialist: 'orders',
      goal: 'Create an order for 10 units and reserve inventory',
      acceptanceCriteria: ['reservation.status === reserved', 'reservation.quantity === 10'],
    });
    const result = await engine.run({
      state,
      plan: async current => ({ tool: current.iteration === 1 ? 'orders.create' : 'inventory.reserve', input: { quantity: 10 } }),
      execute: async tool => tool === 'orders.create'
        ? { success: true, evidence: [{ type: 'order.created', orderId: 'ORDER-1' }] }
        : { success: true, data: { status: 'reserved', quantity: 10 }, evidence: [{ type: 'inventory.reserved', quantity: 10 }] },
      verify: async result => result.data?.status === 'reserved' ? { accepted: true, evidence: result.evidence } : { accepted: false, retryable: true },
    });
    expect(result.status).toBe('completed');
    expect(result.iteration).toBe(2);
    expect(result.evidence).toHaveLength(2);
  });

  test('retries retryable failures but does not retry business failures blindly', async () => {
    const engine = new LoopEngine({ idFactory: () => 'loop_retry', limits: { maxIterations: 4 } });
    const state = engine.createState({ workId: 'W-1', tenantId: 'tenant-1', goal: 'Reserve stock', acceptanceCriteria: ['reserved'] });
    let calls = 0;
    const retry = await engine.run({ state, plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => { calls += 1; return calls === 1 ? { success: false, error: { code: 'NETWORK_TIMEOUT' } } : { success: true, data: { ok: true } }; }, verify: async r => ({ accepted: r.success }) });
    expect(retry.status).toBe('completed');
    expect(calls).toBe(2);

    const business = await engine.run({ state: engine.createState({ workId: 'W-2', tenantId: 'tenant-1', goal: 'Reserve stock', acceptanceCriteria: ['reserved'] }), plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => ({ success: false, error: { code: 'INSUFFICIENT_STOCK' } }), verify: async () => ({ accepted: false }) });
    expect(business.status).toBe('failed');
    expect(business.iteration).toBe(1);
  });

  test('hands approval failures to Project Manager and enforces loop limits', async () => {
    const handoffs = [];
    const engine = new LoopEngine({ idFactory: () => 'loop_gate', limits: { maxIterations: 2, maxHandoffs: 1 }, onHandoff: handoff => { handoffs.push(handoff); return { ...handoff, status: 'proposed' }; } });
    const state = engine.createState({ workId: 'W-3', tenantId: 'tenant-1', specialist: 'inventory', goal: 'Reserve stock', acceptanceCriteria: ['reserved'] });
    const result = await engine.run({ state, plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => ({ success: false, error: { code: 'APPROVAL_REQUIRED' }, executionId: 'exe-1' }), verify: async () => ({ accepted: false }) });
    expect(result.status).toBe('handoff');
    expect(handoffs[0]).toMatchObject({ to: 'project-manager', tenantId: 'tenant-1', parentExecutionId: 'exe-1' });

    const limited = await new LoopEngine({ limits: { maxIterations: 1 } }).run({ state: engine.createState({ workId: 'W-4', tenantId: 'tenant-1', goal: 'Never finish', acceptanceCriteria: ['done'] }), plan: async () => ({ tool: 'noop' }), execute: async () => ({ success: true }), verify: async () => ({ accepted: false, retryable: true }) });
    expect(limited.status).toBe('loop_limit');
  });

  test('does not allow the plan callback to mutate acceptance criteria', async () => {
    const engine = new LoopEngine({ limits: { maxIterations: 1 } });
    const state = engine.createState({ workId: 'W-5', tenantId: 'tenant-1', goal: 'Do not change scope', acceptanceCriteria: ['quantity === 100'] });
    await engine.run({ state, plan: async current => { current.acceptanceCriteria.push('quantity === 1'); return { tool: 'noop' }; }, execute: async () => ({ success: true, data: { quantity: 100 } }), verify: async () => ({ accepted: true }) });
    expect(state.acceptanceCriteria).toEqual(['quantity === 100']);
  });
});

  test('records the required four-layer trace for a successful execution', async () => {
    const engine = new LoopEngine({ idFactory: () => 'loop_trace' });
    const state = engine.createState({ workId: 'TRACE-1', tenantId: 'tenant-1', goal: 'Complete work', acceptanceCriteria: ['done'] });
    const result = await engine.run({ state, plan: async () => ({ tool: 'inventory.reserve', input: {} }), execute: async () => ({ success: true, evidence: [{ type: 'reserved' }] }), verify: async () => ({ accepted: true }) });
    expect(result.trace.map(event => event.event)).toEqual(expect.arrayContaining(['loop.created', 'action.requested', 'tool.executed', 'observation.recorded', 'verification.completed', 'loop.completed']));
    expect(result.work.acceptanceCriteria).toEqual(['done']);
  });

  test('classifies permission denial as an approval handoff', async () => {
    const handoffs = [];
    const engine = new LoopEngine({ onHandoff: async handoff => { handoffs.push(handoff); return { ...handoff, status: 'proposed' }; } });
    const result = await engine.run({ state: engine.createState({ workId: 'PERM-1', tenantId: 'tenant-1', specialist: 'inventory', goal: 'Reserve', acceptanceCriteria: ['reserved'] }), plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => ({ success: false, error: { code: 'PERMISSION_DENIED' } }), verify: async () => ({ accepted: false }) });
    expect(result.status).toBe('handoff');
    expect(handoffs[0].requestedAction).toBe('approval.escalate');
  });

  test('stops on a specialist timeout without leaving a timer behind', async () => {
    const result = await new LoopEngine({ limits: { timeoutMs: 10 } }).run({ state: new LoopEngine({ limits: { timeoutMs: 10 } }).createState({ workId: 'TIMEOUT-1', tenantId: 'tenant-1', goal: 'Reserve', acceptanceCriteria: ['reserved'] }), plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 50)), verify: async () => ({ accepted: true }) });
    expect(result.status).toBe('failed');
    expect(result.blockers[0].code).toBe('TOOL_TIMEOUT');
  });

  test('stops when a specialist is unavailable after bounded retries', async () => {
    const result = await new LoopEngine({ limits: { maxRetries: 1 } }).run({ state: new LoopEngine({ limits: { maxRetries: 1 } }).createState({ workId: 'UNAVAILABLE-1', tenantId: 'tenant-1', goal: 'Reserve', acceptanceCriteria: ['reserved'] }), plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => ({ success: false, error: { code: 'SPECIALIST_UNAVAILABLE' } }), verify: async () => ({ accepted: false }) });
    expect(result.status).toBe('failed');
    expect(result.retries).toBe(1);
  });

  test('fails safely when acceptance verification rejects the observed evidence', async () => {
    const result = await new LoopEngine().run({ state: new LoopEngine().createState({ workId: 'VERIFY-1', tenantId: 'tenant-1', goal: 'Reserve', acceptanceCriteria: ['quantity === 10'] }), plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => ({ success: true, data: { quantity: 5 }, evidence: [{ type: 'reserved', quantity: 5 }] }), verify: async () => ({ accepted: false, reason: 'quantity does not meet acceptance criteria' }) });
    expect(result.status).toBe('failed');
    expect(result.blockers[0].code).toBe('ACCEPTANCE_FAILED');
  });

  test('records a failed handoff as a terminal control-plane failure', async () => {
    const result = await new LoopEngine({ onHandoff: async handoff => ({ ...handoff, status: 'failed' }) }).run({ state: new LoopEngine().createState({ workId: 'HANDOFF-FAIL-1', tenantId: 'tenant-1', specialist: 'inventory', goal: 'Reserve', acceptanceCriteria: ['reserved'] }), plan: async () => ({ tool: 'inventory.reserve' }), execute: async () => ({ success: false, error: { code: 'APPROVAL_REQUIRED' } }), verify: async () => ({ accepted: false }) });
    expect(result.status).toBe('failed');
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'HANDOFF_FAILED' })]));
  });

  test('integrates Work and Execution through the existing TaskRegistry orchestrator', async () => {
    const { AgentOSOrchestrator } = await import('../../src/core/orchestration/orchestrator.js');
    const { TaskRegistry, TaskStatus } = await import('../../src/core/taskRegistry.js');
    const registry = new TaskRegistry();
    const orchestrator = new AgentOSOrchestrator({ taskRegistry: registry, loopEngine: new LoopEngine({ idFactory: () => 'loop_orchestrated' }) });
    const result = await orchestrator.runWork({ workId: 'WORK-1', goal: 'Create and reserve', acceptanceCriteria: ['reserved'], tenantId: 'tenant-1', specialist: 'orders', plan: async current => ({ tool: current.iteration === 1 ? 'orders.create' : 'inventory.reserve' }), execute: async tool => tool === 'orders.create' ? { success: true, evidence: [{ type: 'order.created' }] } : { success: true, data: { reserved: true }, evidence: [{ type: 'inventory.reserved' }] }, verify: async observed => observed.data?.reserved === true ? { accepted: true } : { accepted: false, retryable: true } });
    expect(result.result.status).toBe('completed');
    expect(registry.get(result.taskId)).toMatchObject({ status: TaskStatus.COMPLETED, loopId: 'loop_orchestrated', executionState: 'COMPLETE' });
  });
