import { describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';

const phpRoutes = readFileSync(new URL('../../www/agentos_routes.php', import.meta.url), 'utf8');
const phpDomains = readFileSync(new URL('../../www/agentos_domain_adapters.php', import.meta.url), 'utf8');
const nodeRoutes = readFileSync(new URL('../../server/src/domains/wifi/registerRoutes.js', import.meta.url), 'utf8');

describe('PHP fallback and Node server contract overlap', () => {
  test.each([
    ['/health', 'GET'],
    ['/manifest', 'GET'],
    ['/api/v1/capabilities', 'GET'],
    ['/api/v1/tools', 'GET'],
    ['/api/v1/vouchers', 'GET'],
    ['/api/v1/vouchers', 'POST'],
    ['/api/v1/vouchers/redeem', 'POST'],
    ['/api/payment/methods', 'GET'],
    ['/api/channels', 'GET'],
    ['/channels/capabilities', 'GET'],
    ['/tool/execute', 'POST']
  ])('%s %s exists in the shared fallback/server contract', (path, method) => {
    const phpSource = `${phpRoutes}\n${phpDomains}`;
    expect(phpSource).toContain(path);
    expect(nodeRoutes).toContain(`app.${method.toLowerCase()}('${path}'`);
  });

  test('capability response exposes the same domain families as the PHP fallback', () => {
    for (const domain of ['shopping', 'payments', 'vouchers', 'cctv', 'network', 'channels', 'analytics', 'skills', 'tools', 'identity']) {
      expect(phpDomains).toContain(`'${domain}' =>`);
      expect(nodeRoutes).toContain(`${domain}: { paths:`);
    }
  });
});
