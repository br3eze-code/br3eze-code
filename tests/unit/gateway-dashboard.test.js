import request from 'supertest';
import { Gateway } from '../../src/core/gateway-engine.js';

describe('Gateway local dashboard', () => {
  let gateway;

  beforeEach(() => {
    gateway = new Gateway({ host: '127.0.0.1', port: 19876, health: () => ({ ok: true }) });
  });

  test.each(['/', '/index.html'])('serves the dashboard at %s', async (path) => {
    const response = await request(gateway.getApp()).get(path);
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('AgentOS Gateway');
    expect(response.text).toContain('/health/ready');
  });

  test('keeps the live health endpoint available to the dashboard', async () => {
    const response = await request(gateway.getApp()).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, live: true });
  });
});
