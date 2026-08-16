<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/agentos_domain_adapters.php';

/**
 * Domain-agnostic PHP route parity boundary.
 *
 * This dispatcher is intentionally conservative: local-safe reads return a
 * degraded response, while mutations return a pending response only after
 * authenticated scope, explicit approval, and idempotency checks succeed.
 * It never claims that a remote payment, device, or cloud state changed.
 */

function agentos_request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function agentos_request_path(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    return '/' . trim((string) $path, '/');
}

function agentos_json_body(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') return [];
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function agentos_route_matches(string $pattern, string $path): bool
{
    $regex = preg_replace('#:([A-Za-z0-9_]+)#', '[^/]+', $pattern);
    return (bool) preg_match('#^' . $regex . '$#', $path);
}

function agentos_public_route(string $method, string $path): bool
{
    return ($method === 'GET' && in_array($path, ['/health', '/manifest', '/js/env.js'], true))
        || ($method === 'POST' && preg_match('#^/api/webhook/#', $path) === 1)
        || ($method === 'POST' && preg_match('#^/webhooks/#', $path) === 1)
        || ($method === 'POST' && in_array($path, ['/webhook.php', '/ipn'], true));
}

function agentos_route_catalog(): array
{
    return [
        'GET' => [
            '/health', '/manifest', '/js/env.js', '/api/llm/health', '/api/trends',
            '/api/stats', '/api/token', '/api/memory', '/api/nodes', '/api/v1/nodes',
            '/api/v1/capabilities', '/api/v1/pos/context', '/api/v1/pos/catalog', '/api/v1/pos/shifts/current', '/api/v1/pos/sales/:id', '/api/v1/pos/payments/:id', '/api/payment/methods', '/payment/methods', '/billing/methods',
            '/channels', '/api/channels', '/channels/capabilities', '/api/v1/trends', '/api/v1/tools', '/api/v1/vouchers',
            '/api/v1/vouchers/stats', '/api/v1/analysis/:domain', '/api/v1/channels/telegram/status',
            '/api/v1/print/status', '/api/v1/users/:id/memory', '/api/v1/users/:id/permissions',
            '/api/session/:id', '/api/payment/status/:id', '/api/mesh/exec', '/api/webhooks/pesapal',
            '/api/vouchers', '/api/vouchers/:code', '/api/vouchers/:code/qr', '/analytics/network',
            '/analytics/system', '/analytics/vouchers', '/billing/provider', '/couriers', '/dhcp/leases',
            '/diagnostics', '/diagnostics/connectivity', '/diagnostics/full', '/firewall/list',
            '/financial/report', '/financial/summary', '/financial/transactions', '/financial/trends',
            '/hotspot/profiles', '/nodes', '/nodes/:name', '/orders', '/orders/:id', '/orders/:id/pdf',
            '/orders/:id/track', '/plans', '/product/:id', '/products', '/products/:id', '/providers',
            '/sessions', '/sessions/:id', '/status', '/system/identity', '/system/logs', '/system/ping',
            '/system/resources', '/system/stats', '/tools', '/tools/:tool', '/users/active', '/users/all',
            '/users/status', '/users/:username', '/vouchers', '/vouchers/:code', '/vouchers/:code/qr',
            '/vouchers/stats', '/status/:orderTrackingId', '/webhooks/:provider', '/workflows',
        ],
        'POST' => [
            '/api/ask/stream', '/api/memory', '/api/nodes', '/api/nodes/:name/exec',
            '/api/payment/initiate', '/api/webhook/mpesa/:provider', '/api/v1/analysis/:domain',
            '/api/v1/ask', '/api/v1/print', '/api/v1/proposals/:proposalId/decide',
            '/api/v1/sync', '/api/v1/tasks/:taskId/proposals', '/api/v1/tools', '/api/v1/tools/:tool',
            '/api/v1/users/:id/memory', '/api/v1/users/:id/permissions', '/api/v1/users/kick',
            '/api/v1/users/sync', '/api/v1/vouchers', '/api/v1/vouchers/pay', '/api/v1/vouchers/redeem', '/api/v1/pos/shifts/open', '/api/v1/pos/sales', '/api/v1/pos/sales/:id/hold', '/api/v1/pos/sales/:id/recall', '/api/v1/pos/sales/:id/payments', '/api/v1/pos/sales/:id/refund-request', '/api/v1/pos/sales/:id/void-request',
            '/batch/execute', '/billing/payment-link', '/billing/verify', '/billing/webhook', '/cart',
            '/cart/add', '/cart/remove', '/channels', '/channels/:type/send', '/channels/broadcast',
            '/checkout', '/diagnostics/ping-router', '/execute', '/firewall/block', '/notify',
            '/nodes/:name/command', '/nodes/fanout', '/orders/:id/ship', '/ping', '/register-ipn',
            '/setup', '/system/reboot', '/tool/execute', '/traceroute', '/user', '/users/add',
            '/users/kick', '/users/remove', '/users/sync', '/voucher/generate', '/voucher/redeem',
            '/voucher/validate', '/vouchers/pay', '/vouchers/redeem', '/workflows/:name/trigger',
            '/api/charge-card', '/api/charge-card/confirm', '/api/checkout/create', '/api/checkout/verify',
            '/api/payment-method/save', '/api/setup-intent/create',
        ],
        'PUT' => ['/config', '/api/v1/users/:id/memory', '/api/v1/users/:id/permissions', '/orders/:id'],
        'PATCH' => ['/config', '/api/v1/tasks/:taskId/proposals'],
        'DELETE' => ['/api/memory/:key', '/api/v1/users/:id/memory', '/users/:id/disconnect'],
    ];
}

function agentos_route_exists(string $method, string $path): bool
{
    foreach (agentos_route_catalog()[$method] ?? [] as $pattern) {
        if (agentos_route_matches($pattern, $path)) return true;
    }
    return false;
}

function agentos_route_dispatch(): never
{
    $method = agentos_request_method();
    $path = agentos_request_path();
    $domainMatch = agentos_domain_for_path($path);
    if (!agentos_route_exists($method, $path) && $domainMatch === null) {
        agentos_json(['success' => false, 'code' => 'ROUTE_NOT_FOUND', 'message' => 'AgentOS route is not available.'], 404);
    }

    if ($method === 'GET' && $path === '/health') {
        agentos_json(['success' => true, 'status' => 'degraded-ready', 'service' => 'agentos-php-fallback', 'firebase' => false]);
    }
    if ($method === 'GET' && $path === '/manifest') {
        agentos_json(['name' => 'AgentOS', 'offline' => true, 'routeDispatcher' => true, 'version' => getenv('AGENTOS_VERSION') ?: 'local']);
    }
    if ($method === 'GET' && $path === '/js/env.js') {
        header('Content-Type: application/javascript; charset=utf-8');
        echo 'window.AGENTOS_ENV=' . json_encode(['offlineFirst' => true, 'gatewayConfigured' => (bool) getenv('AGENTOS_GATEWAY_URL')], JSON_UNESCAPED_SLASHES) . ';';
        exit;
    }

    if (!agentos_public_route($method, $path)) {
        $context = agentos_context(true);
    } else {
        $context = ['userId' => null, 'tenantId' => null, 'siteId' => null, 'role' => 'public', 'location' => ['permission' => 'denied', 'available' => false]];
    }

    if ($method === 'GET' && $path === '/api/v1/capabilities') {
        agentos_json([
            'success' => true,
            'status' => 'degraded',
            'serverConfirmed' => false,
            'context' => $context,
            'domains' => array_map(static fn(array $definition): array => ['paths' => $definition['paths'], 'skills' => $definition['skills']], agentos_domain_registry()),
            'paymentMethods' => agentos_payment_methods(),
            'channels' => agentos_channel_capabilities(),
            'message' => 'Local capability manifest; authoritative remote availability is not confirmed.'
        ]);
    }

    if ($domainMatch !== null) {
        agentos_domain_dispatch($method, $path, $context);
    }

    if ($method !== 'GET') {
        agentos_require_mutation_approval();
        $idempotencyKey = agentos_idempotency_key();
        $body = agentos_json_body();
        agentos_json([
            'success' => true,
            'status' => 'pending',
            'queued' => true,
            'serverConfirmed' => false,
            'route' => $path,
            'method' => $method,
            'idempotencyKey' => $idempotencyKey,
            'context' => $context,
            'acceptedFields' => array_keys($body),
            'message' => 'Request accepted for synchronization; no remote state has been changed.',
        ], 202);
    }

    agentos_json([
        'success' => true,
        'status' => 'degraded',
        'serverConfirmed' => false,
        'route' => $path,
        'context' => $context,
        'data' => [],
        'message' => 'No authoritative server is available; returning a safe local fallback response.',
    ]);
}

agentos_route_dispatch();
