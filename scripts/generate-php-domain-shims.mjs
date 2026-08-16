import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = new URL('../www/', import.meta.url).pathname;
const domains = {
  shopping: ['catalog', 'cart', 'checkout', 'orders', 'fulfillment', 'shopping-agent'],
  payments: ['provider-neutral-payments', 'idempotent-settlement', 'webhooks'],
  vouchers: ['voucher-claim', 'voucher-validation', 'qr'],
  cctv: ['cctv-analysis', 'multi-channel-stream', 'audit-trails', 'device-health'],
  network: ['mikrotik', 'network-tools', 'mesh', 'diagnostics', 'wifi'],
  channels: ['telegram', 'whatsapp', 'email', 'sms', 'websocket', 'channel-ui'],
  analytics: ['cctv-analyst', 'shopping-analyst', 'network-analyst', 'lifecycle-graph'],
  skills: ['skill-registry', 'skill-discovery', 'workflow-runner'],
  tools: ['tool-registry', 'batch-execution', 'approval-gate'],
  identity: ['identity', 'tenant-scope', 'permissions', 'location-privacy']
};

const template = (domain) => `<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/agentos_domain_adapters.php';

// Physical ${domain} fallback entrypoint. All security and degraded-mode behavior
// is implemented by the shared domain adapter; this file is intentionally thin.
$context = agentos_context(true);
$definition = agentos_domain_registry()['${domain}'] ?? null;
if ($definition === null) {
    agentos_json(['success' => false, 'code' => 'DOMAIN_NOT_FOUND'], 404);
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    agentos_require_mutation_approval();
    $key = agentos_idempotency_key();
    agentos_json(['success' => true, 'domain' => '${domain}', 'status' => 'pending', 'queued' => true, 'serverConfirmed' => false, 'idempotencyKey' => $key, 'context' => $context, 'skills' => $definition['skills']], 202);
}
agentos_json(['success' => true, 'domain' => '${domain}', 'status' => 'degraded', 'serverConfirmed' => false, 'context' => $context, 'skills' => $definition['skills'], 'data' => []]);
`;

for (const [domain, skills] of Object.entries(domains)) {
  const path = join(root, 'domains', `${domain}.php`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, template(domain));
  for (const skill of skills) {
    const skillPath = join(root, 'skills', `${skill}.php`);
    await mkdir(dirname(skillPath), { recursive: true });
    await writeFile(skillPath, template(domain));
  }
}
console.log(`[AgentOS] generated ${Object.keys(domains).length} domain shims and ${Object.values(domains).flat().length} skill/tool shims`);
