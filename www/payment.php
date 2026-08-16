<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/database_config.php';

$context = agentos_context(true);
$transactionId = (int) agentos_input('transaction_id', 0);
$sessionId = trim((string) agentos_input('session_id', ''));

if ($transactionId <= 0 && $sessionId === '') {
    agentos_json(['success' => false, 'code' => 'REFERENCE_REQUIRED', 'message' => 'A payment reference is required.'], 400);
}

try {
    if ($transactionId > 0) {
        $stmt = $pdo->prepare('SELECT id, status, payment_method, amount_cents, currency, tenant_id, site_id FROM transactions WHERE id = ? AND username = ? AND tenant_id = ? AND (site_id IS NULL OR site_id = ?)');
        $stmt->execute([$transactionId, $context['userId'], $context['tenantId'], $context['siteId']]);
    } else {
        $stmt = $pdo->prepare('SELECT id, status, payment_method, amount_cents, currency, tenant_id, site_id FROM transactions WHERE payment_reference = ? AND username = ? AND tenant_id = ? AND (site_id IS NULL OR site_id = ?)');
        $stmt->execute([$sessionId, $context['userId'], $context['tenantId'], $context['siteId']]);
    }
    $transaction = $stmt->fetch();
    if (!$transaction) agentos_json(['success' => false, 'code' => 'TRANSACTION_NOT_FOUND', 'message' => 'Transaction not found.'], 404);

    $status = strtolower((string) $transaction['status']);
    agentos_json([
        'success' => in_array($status, ['completed', 'succeeded', 'successful', 'paid'], true),
        'status' => $status,
        'payment_method' => $transaction['payment_method'],
        'amount_cents' => (int) $transaction['amount_cents'],
        'currency' => strtoupper((string) $transaction['currency']),
        'transaction_id' => (int) $transaction['id'],
        'traceId' => $context['traceId']
    ]);
} catch (Throwable $error) {
    agentos_safe_exception($error);
}
