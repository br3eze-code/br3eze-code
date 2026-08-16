<?php
declare(strict_types=1);

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST', true, 405);
    exit;
}

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/database_config.php';
require_once __DIR__ . '/mikrotik_functions.php';

$payload = file_get_contents('php://input') ?: '';
$event = json_decode($payload, true);
if (!is_array($event)) {
    agentos_json(['success' => false, 'code' => 'INVALID_PAYLOAD', 'message' => 'Invalid webhook payload.'], 400);
}

$provider = strtolower((string) (agentos_header('X-AgentOS-Provider') ?? $event['provider'] ?? ''));
if ($provider === '') {
    $provider = agentos_header('Stripe-Signature') !== null ? 'stripe' : 'ecocash';
}

function agentos_verify_stripe(string $payload): bool
{
    $header = agentos_header('Stripe-Signature');
    $secret = getenv('STRIPE_WEBHOOK_SECRET') ?: '';
    if ($header === null || $secret === '') return false;
    $timestamp = null;
    $signatures = [];
    foreach (explode(',', $header) as $part) {
        [$key, $value] = array_pad(explode('=', trim($part), 2), 2, null);
        if ($key === 't') $timestamp = ctype_digit((string) $value) ? (int) $value : null;
        if ($key === 'v1' && is_string($value)) $signatures[] = $value;
    }
    $tolerance = max(1, (int) (getenv('STRIPE_WEBHOOK_TOLERANCE') ?: 300));
    if ($timestamp === null || abs(time() - $timestamp) > $tolerance || !$signatures) return false;
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($signatures as $signature) {
        if (hash_equals($expected, $signature)) return true;
    }
    return false;
}

function agentos_verify_ecocash(string $payload): bool
{
    $signature = agentos_header('X-EcoCash-Signature') ?? agentos_header('X-AgentOS-Signature');
    $secret = getenv('ECOCASH_WEBHOOK_SECRET') ?: (getenv('ECOCASH_API_KEY') ?: '');
    if ($signature === null || $secret === '') return false;
    $provided = str_starts_with($signature, 'v1=') ? substr($signature, 3) : $signature;
    $timestamp = agentos_header('X-EcoCash-Timestamp');
    $signedPayload = $timestamp !== null ? $timestamp . '.' . $payload : $payload;
    $expected = hash_hmac('sha256', $signedPayload, $secret);
    return hash_equals($expected, $provided);
}

$verified = match ($provider) {
    'stripe' => agentos_verify_stripe($payload),
    'ecocash' => agentos_verify_ecocash($payload),
    default => false,
};
if (!$verified) {
    agentos_json(['success' => false, 'code' => 'INVALID_SIGNATURE', 'message' => 'Invalid or unsupported webhook signature.'], 400);
}

$type = (string) ($event['type'] ?? $event['status'] ?? '');
$object = $event['data']['object'] ?? $event['data'] ?? $event;
$metadata = is_array($object['metadata'] ?? null) ? $object['metadata'] : [];
$transactionId = (int) ($metadata['local_transaction_id'] ?? $object['transaction_id'] ?? 0);
$paymentReference = (string) ($object['id'] ?? $object['transactionRef'] ?? $object['payment_reference'] ?? '');
$eventId = (string) ($event['id'] ?? $object['event_id'] ?? $paymentReference);
$successTypes = $provider === 'stripe'
    ? ['payment_intent.succeeded', 'checkout.session.completed']
    : ['SUCCESS', 'SUCCESSFUL', 'payment.succeeded', 'payment_success'];

if (!in_array(strtoupper($type), array_map('strtoupper', $successTypes), true)) {
    agentos_json(['success' => true, 'status' => 'ignored', 'provider' => $provider]);
}
if ($transactionId <= 0 || $paymentReference === '' || $eventId === '') {
    agentos_json(['success' => false, 'code' => 'WEBHOOK_REFERENCE_REQUIRED', 'message' => 'Webhook transaction reference is missing.'], 400);
}

try {
    $pdo->beginTransaction();
    $eventInsert = $pdo->prepare('INSERT INTO webhook_events (provider, event_id) VALUES (?, ?)');
    try {
        $eventInsert->execute([$provider, $eventId]);
    } catch (PDOException $duplicate) {
        if ((string) $duplicate->getCode() === '23000' || str_contains(strtolower($duplicate->getMessage()), 'unique')) {
            $pdo->rollBack();
            agentos_json(['success' => true, 'status' => 'already_processed', 'event_id' => $eventId]);
        }
        throw $duplicate;
    }

    $stmt = $pdo->prepare('SELECT id, username, product_id, status, amount_cents, currency, payment_method FROM transactions WHERE id = ?');
    $stmt->execute([$transactionId]);
    $transaction = $stmt->fetch();
    if (!$transaction) {
        $pdo->commit();
        agentos_json(['success' => true, 'status' => 'ignored']);
    }
    if (in_array(strtolower((string) $transaction['status']), ['completed', 'succeeded', 'successful', 'paid', 'paid_pending_fulfillment'], true)) {
        $pdo->commit();
        agentos_json(['success' => true, 'status' => 'already_processed', 'event_id' => $eventId]);
    }

    $eventAmount = $object['amount_total'] ?? $object['amount_received'] ?? $object['amount'] ?? null;
    if ($eventAmount !== null) {
        $eventCents = $provider === 'ecocash' && is_string($eventAmount) && str_contains($eventAmount, '.')
            ? (int) round((float) $eventAmount * 100) : (int) $eventAmount;
        if ($eventCents !== (int) $transaction['amount_cents']) throw new RuntimeException('WEBHOOK_AMOUNT_MISMATCH');
    }
    $eventCurrency = strtoupper((string) ($object['currency'] ?? ''));
    if ($eventCurrency !== '' && $eventCurrency !== strtoupper((string) $transaction['currency'])) throw new RuntimeException('WEBHOOK_CURRENCY_MISMATCH');

    $status = 'completed';
    if (getenv('AGENTOS_AUTO_FULFILL') === '1') {
        $productStmt = $pdo->prepare('SELECT mikrotik_profile FROM products WHERE id = ?');
        $productStmt->execute([(int) $transaction['product_id']]);
        $product = $productStmt->fetch();
        if ($product && !empty($product['mikrotik_profile'])) {
            $router = updateUserProfileOnMikroTik((string) $transaction['username'], (string) $product['mikrotik_profile']);
            if (!$router['success'] && ($router['code'] ?? '') === 'NOT_CONFIGURED') $status = 'paid_pending_fulfillment';
            elseif (!$router['success']) throw new RuntimeException('FULFILLMENT_FAILED');
        }
    }

    $update = $pdo->prepare('UPDATE transactions SET status = ?, payment_reference = ?, provider_event_id = ? WHERE id = ? AND status = ?');
    $update->execute([$status, $paymentReference, $eventId, $transactionId, $transaction['status']]);
    $pdo->commit();
    agentos_json(['success' => true, 'status' => $status, 'provider' => $provider, 'event_id' => $eventId]);
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    agentos_safe_exception($error);
}
