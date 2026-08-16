import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('gateway next-action proposal routes', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = fs.readFileSync(path.join(root, 'src/core/gateway-engine.js'), 'utf8');

  test('proposal routes are mounted after API authentication', () => {
    const authIndex = source.indexOf("this.app.use('/api', async");
    const readIndex = source.indexOf("this.app.get('/api/v1/tasks/:taskId/proposals'");
    const decideIndex = source.indexOf("this.app.post('/api/v1/proposals/:proposalId/decide'");
    expect(authIndex).toBeGreaterThanOrEqual(0);
    expect(readIndex).toBeGreaterThan(authIndex);
    expect(decideIndex).toBeGreaterThan(readIndex);
  });

  test('proposal routes require verified Firebase identity and canonical task access', () => {
    const routeStart = source.indexOf("this.app.get('/api/v1/tasks/:taskId/proposals'");
    const routeEnd = source.indexOf("// ── SSE streaming /ask", routeStart);
    const routes = source.slice(routeStart, routeEnd);
    expect(source).toContain('Firebase identity required for proposal access');
    expect(routes).toContain('getUserTask(req.params.taskId, context)');
    expect(routes).toContain('validateNextActionProposal');
    expect(routes).toContain('recordProactiveDecision');
    expect(routes).toContain('this.proactiveTelemetry.record');
  });

  test('analysis context cannot be overridden by request-body identity fields', () => {
    const routeStart = source.indexOf("this.app.post('/api/v1/analysis/:domain'");
    const routeEnd = source.indexOf("this.app.get('/api/v1/tasks/:taskId/proposals'", routeStart);
    const route = source.slice(routeStart, routeEnd);
    expect(route.indexOf('...(req.body?.context || {})')).toBeLessThan(route.indexOf('...proposalContext(req)'));
    expect(route).toContain("domain: req.params.domain");
  });

  test('decision vocabulary is not widened by the gateway', () => {
    const routeStart = source.indexOf("this.app.post('/api/v1/proposals/:proposalId/decide'");
    const routeEnd = source.indexOf('// ── A2A Protocol Routes', routeStart);
    const route = source.slice(routeStart, routeEnd);
    expect(route).toContain('recordProactiveDecision');
    expect(route).not.toContain('req.body?.command');
    expect(route).not.toContain('global.mikrotik');
  });
});

export {};

