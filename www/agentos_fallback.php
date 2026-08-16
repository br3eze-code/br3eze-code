<?php
declare(strict_types=1);

/**
 * AgentOS PHP fallback boundary.
 *
 * This file is deliberately provider-neutral and must never become an
 * authentication authority. Production deployments should inject the same
 * verified identity headers or signed context envelope used by the Node
 * gateway. Request-body identity fields are not trusted.
 */

function agentos_json(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function agentos_header(string $name): ?string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    $value = $_SERVER[$key] ?? null;
    if (!is_string($value) || trim($value) === '') return null;
    return trim($value);
}

function agentos_required_header(string $name): string
{
    $value = agentos_header($name);
    if ($value === null) agentos_json(['success' => false, 'code' => 'CONTEXT_REQUIRED', 'message' => 'Authenticated AgentOS context is required.'], 401);
    return $value;
}

function agentos_context(bool $requireTenant = true): array
{
    $userId = agentos_required_header('X-AgentOS-User-Id');
    $tenantId = agentos_header('X-AgentOS-Tenant-Id');
    $siteId = agentos_header('X-AgentOS-Site-Id');
    $role = agentos_header('X-AgentOS-Role') ?? 'user';
    $locationPermission = strtolower(agentos_header('X-AgentOS-Location-Permission') ?? 'denied');

    if ($requireTenant && $tenantId === null) {
        agentos_json(['success' => false, 'code' => 'TENANT_REQUIRED', 'message' => 'Tenant scope is required.'], 403);
    }

    if (!preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $userId)) {
        agentos_json(['success' => false, 'code' => 'INVALID_IDENTITY', 'message' => 'Invalid authenticated identity.'], 401);
    }
    if ($tenantId !== null && !preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $tenantId)) {
        agentos_json(['success' => false, 'code' => 'INVALID_TENANT', 'message' => 'Invalid tenant scope.'], 403);
    }
    if ($siteId !== null && !preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $siteId)) {
        agentos_json(['success' => false, 'code' => 'INVALID_SITE', 'message' => 'Invalid site scope.'], 403);
    }

    $normalizedRole = preg_replace('/[^A-Za-z0-9_.:-]/', '', $role) ?: 'user';
    $channel = strtolower(preg_replace('/[^A-Za-z0-9_.:-]/', '', agentos_header('X-AgentOS-Channel') ?? 'web') ?: 'web');
    $domain = strtolower(preg_replace('/[^A-Za-z0-9_.:-]/', '', agentos_header('X-AgentOS-Domain') ?? 'core') ?: 'core');
    $approval = strtolower(agentos_header('X-AgentOS-Mutation-Approval') ?? '');
    $traceId = agentos_header('X-AgentOS-Trace-Id') ?? bin2hex(random_bytes(16));
    return [
        'contextType' => 'agentos.execution',
        'contextVersion' => 1,
        'userId' => $userId,
        'tenantId' => $tenantId,
        'siteId' => $siteId,
        'scope' => ['tenantId' => $tenantId, 'siteId' => $siteId, 'userId' => $userId],
        'role' => $normalizedRole,
        'permissions' => ['location' => $locationPermission === 'granted'],
        'capabilities' => ['read' => true, 'mutate' => $approval === 'approved' || $approval === 'explicit'],
        'channel' => $channel,
        'domain' => $domain,
        'approval' => ['required' => true, 'provided' => in_array($approval, ['approved', 'explicit'], true)],
        'location' => [
            'permission' => $locationPermission === 'granted' ? 'granted' : 'denied',
            'available' => $locationPermission === 'granted'
        ],
        'source' => 'php-fallback',
        'traceId' => $traceId
    ];
}

function agentos_input(string $key, mixed $default = null): mixed
{
    return $_POST[$key] ?? $_GET[$key] ?? $default;
}

function agentos_require_mutation_approval(): void
{
    $approval = strtolower(agentos_header('X-AgentOS-Mutation-Approval') ?? '');
    if (!in_array($approval, ['approved', 'explicit'], true)) {
        agentos_json(['success' => false, 'code' => 'APPROVAL_REQUIRED', 'message' => 'Explicit approval is required for this mutation.'], 428);
    }
}

function agentos_idempotency_key(): string
{
    $key = agentos_header('Idempotency-Key');
    if ($key === null || !preg_match('/^[A-Za-z0-9._:-]{8,128}$/', $key)) {
        agentos_json(['success' => false, 'code' => 'IDEMPOTENCY_REQUIRED', 'message' => 'A valid Idempotency-Key is required.'], 400);
    }
    return $key;
}

function agentos_provider(string $requested, array $allowed = ['stripe', 'paynow', 'ecocash', 'netone', 'pesapay', 'mpesa', 'mastercard', 'apple_pay', 'google_pay', 'innbucks', 'manual']): string
{
    $provider = strtolower(trim($requested));
    if (!in_array($provider, $allowed, true)) {
        agentos_json(['success' => false, 'code' => 'UNSUPPORTED_PROVIDER', 'message' => 'Unsupported payment provider.'], 400);
    }
    return $provider;
}

function agentos_safe_exception(Throwable $error): void
{
    error_log('[AgentOS PHP fallback] ' . $error->getMessage());
    agentos_json(['success' => false, 'code' => 'FALLBACK_ERROR', 'message' => 'The fallback service could not complete the request.'], 500);
}
