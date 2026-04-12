// tests/AgentOS.test.js
const AgentOS = require('../src/core/AgentOS');

describe('AgentOS', () => {
  let agent;

  beforeEach(async () => {
    agent = new AgentOS({
      memoryAdapter: 'memory',
      llmProvider: 'local'
    });
    await agent.initialize();
  });

  afterEach(async () => {
    await agent.destroy();
  });

  test('initializes with skills', () => {
    expect(agent.skills.count()).toBeGreaterThan(0);
  });

  test('processes interaction', async () => {
    const result = await agent.processInteraction({
      action: 'test.echo',
      params: { message: 'hello' },
      userId: 'test-user'
    });
    
    expect(result.success).toBe(true);
  });

  test('handles unknown skill', async () => {
    const result = await agent.processInteraction({
      action: 'unknown.skill',
      userId: 'test-user'
    });
    
    expect(result.success).toBe(false);
  });
});
