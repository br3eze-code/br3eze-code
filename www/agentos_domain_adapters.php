<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';

/**
 * Domain and skill fallback registry. These adapters intentionally expose
 * capabilities and safe local state only. Remote mutations are accepted as
 * pending and require the same identity, tenant, approval, and idempotency
 * boundary as the Node gateway.
 */
function agentos_domain_registry(): array
{
    return [
        'shopping' => ['paths' => ['/shop', '/products', '/products/:id', '/product/:id', '/cart', '/cart/add', '/cart/remove', '/checkout', '/orders', '/orders/:id', '/orders/:id/ship', '/orders/:id/track', '/couriers'], 'skills' => ['catalog', 'cart', 'checkout', 'orders', 'fulfillment', 'shopping-agent']],
        'payments' => ['paths' => ['/api/payment/initiate', '/api/payment/status/:id', '/api/charge-card', '/api/charge-card/confirm', '/api/setup-intent/create', '/api/payment-method/save', '/billing/payment-link', '/billing/provider', '/billing/verify', '/billing/webhook', '/checkout/create', '/checkout/verify'], 'skills' => ['provider-neutral-payments', 'idempotent-settlement', 'webhooks']],
        'vouchers' => ['paths' => ['/voucher/generate', '/voucher/redeem', '/voucher/validate', '/vouchers', '/vouchers/:code', '/vouchers/:code/qr', '/vouchers/pay', '/vouchers/redeem', '/vouchers/stats', '/api/v1/vouchers', '/api/v1/vouchers/:code', '/api/v1/vouchers/redeem'], 'skills' => ['voucher-claim', 'voucher-validation', 'qr']],
        'cctv' => ['paths' => ['/api/v1/analysis/cctv', '/api/v1/cctv/stream/multi', '/cctv', '/cctv/stream', '/cctv/stream/multi', '/diagnostics/cctv'], 'skills' => ['cctv-analysis', 'multi-channel-stream', 'audit-trails', 'device-health']],
        'network' => ['paths' => ['/api/nodes', '/api/nodes/:name/exec', '/api/mesh/exec', '/nodes', '/nodes/:name', '/nodes/:name/command', '/nodes/fanout', '/ping', '/traceroute', '/firewall/list', '/firewall/block', '/dhcp/leases', '/diagnostics', '/diagnostics/connectivity', '/diagnostics/full', '/diagnostics/ping-router', '/hotspot/profiles', '/hotspot/profiles/:name'], 'skills' => ['mikrotik', 'network-tools', 'mesh', 'diagnostics', 'wifi']],
        'channels' => ['paths' => ['/channels', '/channels/:type/send', '/channels/broadcast', '/api/v1/channels/telegram/status', '/notify', '/webhooks/email'], 'skills' => ['telegram', 'whatsapp', 'email', 'sms', 'websocket', 'channel-ui']],
        'analytics' => ['paths' => ['/analytics/network', '/analytics/system', '/analytics/vouchers', '/financial/report', '/financial/summary', '/financial/transactions', '/financial/trends', '/api/v1/analysis/:domain'], 'skills' => ['cctv-analyst', 'shopping-analyst', 'network-analyst', 'lifecycle-graph']],
        'skills' => ['paths' => ['/skills', '/skills/:name', '/skills/:name/invoke', '/workflows', '/workflows/:name/trigger'], 'skills' => ['skill-registry', 'skill-discovery', 'workflow-runner']],
        'tools' => ['paths' => ['/tools', '/tools/:tool', '/tool/execute', '/api/v1/tools', '/api/v1/tools/:tool', '/batch/execute', '/execute'], 'skills' => ['tool-registry', 'batch-execution', 'approval-gate']],
        'identity' => ['paths' => ['/user', '/users/active', '/users/all', '/users/status', '/users/add', '/users/remove', '/users/kick', '/users/sync', '/system/identity', '/api/v1/users/sync', '/api/v1/users/kick'], 'skills' => ['identity', 'tenant-scope', 'permissions', 'location-privacy']],
    ];
}

function agentos_domain_matches(string $pattern, string $path): bool
{
    $regex = preg_replace('#:([A-Za-z0-9_]+)#', '[^/]+', $pattern);
    return (bool) preg_match('#^' . $regex . '$#', $path);
}

function agentos_domain_for_path(string $path): ?array
{
    foreach (agentos_domain_registry() as $domain => $definition) {
        foreach ($definition['paths'] as $pattern) {
            if (agentos_domain_matches($pattern, $path)) return ['name' => $domain, 'definition' => $definition];
        }
    }
    return null;
}

function agentos_payment_methods(): array
{
    $configured = [
        'stripe' => ['name' => 'Card', 'type' => 'card', 'credentials' => ['STRIPE_SECRET_KEY']],
        'ecocash' => ['name' => 'EcoCash', 'type' => 'mobile_money', 'credentials' => ['ECOCASH_API_KEY', 'ECOCASH_MERCHANT_CODE']],
        'netone' => ['name' => 'OneMoney', 'type' => 'mobile_money', 'credentials' => ['NETONE_API_KEY', 'NETONE_MERCHANT_ID']],
        'paynow' => ['name' => 'PayNow', 'type' => 'aggregator', 'credentials' => ['PAYNOW_INTEGRATION_ID', 'PAYNOW_INTEGRATION_KEY']],
        'pesapay' => ['name' => 'PesaPay', 'type' => 'aggregator', 'credentials' => ['PESAPAY_CONSUMER_KEY', 'PESAPAY_CONSUMER_SECRET']],
        'mpesa' => ['name' => 'M-Pesa', 'type' => 'mobile_money', 'credentials' => ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET']],
        'mastercard' => ['name' => 'Mastercard', 'type' => 'card', 'credentials' => ['MASTERCARD_API_KEY']],
        'apple_pay' => ['name' => 'Apple Pay', 'type' => 'wallet', 'credentials' => ['APPLE_PAY_MERCHANT_ID']],
        'google_pay' => ['name' => 'Google Pay', 'type' => 'wallet', 'credentials' => ['GOOGLE_PAY_MERCHANT_ID']],
        'innbucks' => ['name' => 'InnBucks', 'type' => 'mobile_money', 'credentials' => ['INNBUCKS_API_KEY']],
        'manual' => ['name' => 'Manual/Invoice', 'type' => 'offline', 'credentials' => []],
    ];
    $methods = [];
    foreach ($configured as $id => $definition) {
        $ready = $id === 'manual';
        foreach ($definition['credentials'] as $credential) {
            if (($value = getenv($credential)) !== false && trim((string) $value) !== '') $ready = true;
        }
        $methods[] = ['id' => $id, 'name' => $definition['name'], 'type' => $definition['type'], 'configured' => $ready, 'serverConfirmed' => false];
    }
    return $methods;
}

function agentos_channel_capabilities(): array
{
    return array_map(static fn(string $id): array => ['id' => $id, 'domainAgnostic' => true, 'serverConfirmed' => false], [
        'telegram', 'whatsapp', 'email', 'sms', 'websocket', 'webpush', 'web', 'cordova', 'electron', 'cli'
    ]);
}

function agentos_domain_dispatch(string $method, string $path, array $context): never
{
    $match = agentos_domain_for_path($path);
    if ($match === null) {
        agentos_json(['success' => false, 'code' => 'DOMAIN_NOT_FOUND', 'message' => 'No PHP domain adapter is registered for this route.'], 404);
    }

    if ($method === 'GET' && in_array($path, ['/api/payment/methods', '/payment/methods', '/billing/methods'], true)) {
        agentos_json(['success' => true, 'domain' => 'payments', 'status' => 'degraded', 'serverConfirmed' => false, 'methods' => agentos_payment_methods(), 'context' => $context]);
    }
    if ($method === 'GET' && in_array($path, ['/channels', '/api/channels', '/channels/capabilities'], true)) {
        agentos_json(['success' => true, 'domain' => 'channels', 'status' => 'degraded', 'serverConfirmed' => false, 'channels' => agentos_channel_capabilities(), 'context' => $context]);
    }

    if ($method !== 'GET') {
        agentos_require_mutation_approval();
        $idempotencyKey = agentos_idempotency_key();
        agentos_json([
            'success' => true,
            'domain' => $match['name'],
            'status' => 'pending',
            'queued' => true,
            'serverConfirmed' => false,
            'route' => $path,
            'idempotencyKey' => $idempotencyKey,
            'context' => $context,
            'skills' => $match['definition']['skills'],
            'message' => 'Domain operation queued; no remote state has changed.',
        ], 202);
    }

    agentos_json([
        'success' => true,
        'domain' => $match['name'],
        'status' => 'degraded',
        'serverConfirmed' => false,
        'route' => $path,
        'context' => $context,
        'skills' => $match['definition']['skills'],
        'data' => [],
        'message' => 'Domain adapter is available locally, but authoritative remote data is unavailable.',
    ]);
}
