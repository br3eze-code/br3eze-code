<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/database_config.php';

$context = agentos_context(true);
agentos_require_mutation_approval();
$idempotencyKey = agentos_idempotency_key();
$productId = (int) agentos_input('product_id', 0);
$provider = agentos_provider((string) agentos_input('provider', 'paynow'), ['paynow', 'stripe', 'ecocash', 'manual']);

if ($productId <= 0) agentos_json(['success' => false, 'code' => 'PRODUCT_REQUIRED', 'message' => 'Product is required.'], 400);

try {
    $existing = $pdo->prepare('SELECT id, status, payment_method, amount_cents, currency FROM transactions WHERE idempotency_key = ? AND tenant_id = ? AND username = ?');
    $existing->execute([$idempotencyKey, $context['tenantId'], $context['userId']]);
    $previous = $existing->fetch();
    if ($previous) {
        agentos_json([
            'success' => true,
            'status' => $previous['status'],
            'provider' => $previous['payment_method'],
            'amount_cents' => (int) $previous['amount_cents'],
            'currency' => $previous['currency'],
            'transaction_id' => (int) $previous['id'],
            'idempotent_replay' => true,
            'traceId' => $context['traceId']
        ], 202);
    }

    $productStmt = $pdo->prepare('SELECT id, name, price_cents, currency, price_id FROM products WHERE id = ? AND tenant_id = ? AND (site_id IS NULL OR site_id = ?) AND active = 1');
    $productStmt->execute([$productId, $context['tenantId'], $context['siteId']]);
    $product = $productStmt->fetch();
    if (!$product) agentos_json(['success' => false, 'code' => 'PRODUCT_NOT_FOUND', 'message' => 'Product not found.'], 404);

    $transactionStmt = $pdo->prepare(
        "INSERT INTO transactions (username, tenant_id, site_id, product_id, amount_cents, currency, payment_method, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)"
    );
    $transactionStmt->execute([
        $context['userId'],
        $context['tenantId'],
        $context['siteId'],
        $productId,
        (int) $product['price_cents'],
        strtoupper((string) $product['currency']),
        $provider,
        $idempotencyKey
    ]);
    $transactionId = $pdo->lastInsertId();

    $result = [
        'success' => true,
        'status' => 'pending',
        'provider' => $provider,
        'amount_cents' => (int) $product['price_cents'],
        'currency' => strtoupper((string) $product['currency']),
        'transaction_id' => $transactionId,
        'return_url' => rtrim(getenv('AGENTOS_BASE_URL') ?: '', '/') . '/payment.php?transaction_id=' . rawurlencode((string) $transactionId),
        'traceId' => $context['traceId']
    ];

    if ($provider !== 'manual' && getenv('AGENTOS_' . strtoupper($provider) . '_ENABLED') !== '1') {
        $result['code'] = 'PROVIDER_DEFERRED';
        $result['message'] = 'Payment provider is not enabled in this fallback deployment.';
    }
    agentos_json($result, 202);
} catch (PDOException $error) {
    if ((string) $error->getCode() === '23000' || str_contains(strtolower($error->getMessage()), 'unique')) {
        agentos_json(['success' => false, 'code' => 'IDEMPOTENCY_REPLAY', 'message' => 'This request was already submitted.'], 409);
    }
    agentos_safe_exception($error);
}
