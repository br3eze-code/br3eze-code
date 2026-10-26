import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

describe('domain-neutral gateway composition', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const source = fs.readFileSync(path.join(root, 'src/core/gateway-engine.js'), 'utf8');

  test('mounts only host-injected routes after common middleware', () => {
    expect(source).toContain('for (const middleware of this.config.middleware)');
    expect(source).toContain('for (const route of this.config.routes)');
    expect(source).toContain('this.app.use(route.path, route.router)');
    expect(source).toContain('addRoute(path, router)');
  });

  test('does not hard-code proposal, identity-provider, or network-vendor routes in core', () => {
    expect(source).not.toContain('/api/v1/tasks/:taskId/proposals');
    expect(source).not.toContain('Firebase identity required for proposal access');
    expect(source).not.toContain('global.mikrotik');
    expect(source).not.toContain('req.body?.command');
  });

  test('keeps host-specific authentication and next-action decisions outside the gateway core', () => {
    expect(source).not.toContain('validateNextActionProposal');
    expect(source).not.toContain('recordProactiveDecision');
    expect(source).toContain('health: config.health');
  });
});

export {};
