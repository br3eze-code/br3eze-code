<?php
declare(strict_types=1);

$root = dirname(__DIR__) . '/www';
$dispatcher = file_get_contents($root . '/agentos_routes.php');
$rewrite = file_get_contents($root . '/.htaccess');

$required = [
    "'/health'",
    "'/api/v1/analysis/:domain'",
    "'/api/v1/sync'",
    "'/api/v1/tasks/:taskId/proposals'",
    "'/api/v1/proposals/:proposalId/decide'",
    "'/checkout'",
    "'/orders'",
    "'/vouchers'",
    "'/channels'",
    "'/webhooks/:provider'",
];

foreach ($required as $route) {
    if (!str_contains($dispatcher, $route)) {
        fwrite(STDERR, "missing-route={$route}\n");
        exit(1);
    }
}

if (!str_contains($dispatcher, 'agentos_require_mutation_approval') || !str_contains($dispatcher, 'agentos_idempotency_key')) {
    fwrite(STDERR, "missing-mutation-guards\n");
    exit(1);
}
if (!str_contains($rewrite, 'route.php')) {
    fwrite(STDERR, "missing-rewrite-entrypoint\n");
    exit(1);
}

echo "php-route-smoke=pass\n";
