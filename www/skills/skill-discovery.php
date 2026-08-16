<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/agentos_domain_adapters.php';

// Physical skills fallback entrypoint. All security and degraded-mode behavior
// is implemented by the shared domain adapter; this file is intentionally thin.
$context = agentos_context(true);
$definition = agentos_domain_registry()['skills'] ?? null;
if ($definition === null) {
    agentos_json(['success' => false, 'code' => 'DOMAIN_NOT_FOUND'], 404);
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    agentos_require_mutation_approval();
    $key = agentos_idempotency_key();
    agentos_json(['success' => true, 'domain' => 'skills', 'status' => 'pending', 'queued' => true, 'serverConfirmed' => false, 'idempotencyKey' => $key, 'context' => $context, 'skills' => $definition['skills']], 202);
}
agentos_json(['success' => true, 'domain' => 'skills', 'status' => 'degraded', 'serverConfirmed' => false, 'context' => $context, 'skills' => $definition['skills'], 'data' => []]);
