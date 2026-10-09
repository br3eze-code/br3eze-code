<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/database_config.php';

$context = agentos_context(true);
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$resource = strtolower(trim((string) agentos_input('resource', 'products')));
$id = (string) agentos_input('id', '');
$payload = json_decode(file_get_contents('php://input') ?: '{}', true);
$payload = is_array($payload) ? $payload : [];

$allowed = ['products', 'users', 'plans', 'tickets', 'orders'];
if (!in_array($resource, $allowed, true)) agentos_json(['success' => false, 'code' => 'RESOURCE_NOT_FOUND'], 404);
if ($resource === 'users' && $context['role'] !== 'admin' && $id !== $context['userId']) {
    agentos_json(['success' => false, 'code' => 'FORBIDDEN'], 403);
}
if ($resource === 'orders' && $method === 'GET' && $context['role'] !== 'admin') {
    $id = $id !== '' ? $id : $context['userId'];
}

try {
    if ($method === 'GET') {
        $sql = match ($resource) {
            'products' => 'SELECT id, tenant_id, site_id, name, description, category, price_cents, currency, stock, image_url, sizes, active, created_at FROM products WHERE tenant_id = ? AND active = 1 ORDER BY created_at DESC',
            'users' => 'SELECT id, tenant_id, site_id, username, email, fullname, role, credits, created_at FROM users WHERE tenant_id = ? AND id = ?',
            'plans' => 'SELECT id, tenant_id, name, price_cents, duration_value, duration_unit, active FROM plans WHERE tenant_id = ? AND active = 1 ORDER BY price_cents',
            'tickets' => 'SELECT id, tenant_id, user_id, subject, status, last_update, created_at FROM tickets WHERE tenant_id = ? AND (user_id = ? OR ? = "admin") ORDER BY last_update DESC',
            'orders' => $context['role'] === 'admin' ? 'SELECT id, tenant_id, user_id, items_json, subtotal_cents, shipping_cents, total_cents, currency, status, created_at FROM orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100' : 'SELECT id, tenant_id, user_id, items_json, subtotal_cents, shipping_cents, total_cents, currency, status, created_at FROM orders WHERE tenant_id = ? AND user_id = ? ORDER BY created_at DESC',
        };
        $params = match ($resource) {
            'users' => [$context['tenantId'], $id],
            'tickets' => [$context['tenantId'], $context['userId'], $context['role']],
            'orders' => $context['role'] === 'admin' ? [$context['tenantId']] : [$context['tenantId'], $context['userId']],
            default => [$context['tenantId']],
        };
        $statement = $pdo->prepare($sql); $statement->execute($params);
        $rows = $statement->fetchAll();
        foreach ($rows as &$row) {
            if (isset($row['items_json'])) { $row['items'] = json_decode((string) $row['items_json'], true) ?: []; unset($row['items_json']); }
            if (isset($row['sizes'])) $row['sizes'] = json_decode((string) $row['sizes'], true) ?: [];
            foreach (['price_cents','subtotal_cents','shipping_cents','total_cents'] as $money) if (isset($row[$money])) $row[str_replace('_cents', '', $money)] = ((int) $row[$money]) / 100;
        }
        agentos_json(['success' => true, 'resource' => $resource, 'data' => $rows, 'context' => $context]);
    }

    agentos_require_mutation_approval();
    $key = agentos_idempotency_key();
    if ($resource !== 'orders' || $method !== 'POST') agentos_json(['success' => false, 'code' => 'METHOD_NOT_ALLOWED'], 405);
    $items = is_array($payload['items'] ?? null) ? $payload['items'] : [];
    if (!$items || count($items) > 100) agentos_json(['success' => false, 'code' => 'INVALID_ITEMS'], 422);
    $pdo->beginTransaction();
    $total = 0; $normalized = [];
    foreach ($items as $item) {
        $productId = (int) ($item['productId'] ?? 0); $qty = filter_var($item['qty'] ?? null, FILTER_VALIDATE_INT);
        if ($productId < 1 || $qty === false || $qty < 1 || $qty > 100) throw new InvalidArgumentException('Invalid order item.');
        $s = $pdo->prepare('SELECT id, name, price_cents, stock FROM products WHERE id = ? AND tenant_id = ? AND active = 1'); $s->execute([$productId, $context['tenantId']]); $product = $s->fetch();
        if (!$product || (int) $product['stock'] < $qty) throw new InvalidArgumentException('Product unavailable or insufficient stock.');
        $total += (int) $product['price_cents'] * $qty; $normalized[] = ['productId' => $productId, 'name' => $product['name'], 'price' => ((int) $product['price_cents']) / 100, 'qty' => $qty];
        $u = $pdo->prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND tenant_id = ? AND stock >= ?'); $u->execute([$qty, $productId, $context['tenantId'], $qty]);
    }
    $shipping = 500; $insert = $pdo->prepare('INSERT INTO orders (tenant_id, site_id, user_id, items_json, subtotal_cents, shipping_cents, total_cents, currency, status, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $insert->execute([$context['tenantId'], $context['siteId'], $context['userId'], json_encode($normalized), $total, $shipping, $total + $shipping, 'USD', 'pending_payment', $key]);
    $orderId = $pdo->lastInsertId(); $pdo->commit();
    agentos_json(['success' => true, 'id' => $orderId, 'status' => 'pending_payment', 'items' => $normalized, 'total' => ($total + $shipping) / 100], 201);
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($error instanceof InvalidArgumentException) agentos_json(['success' => false, 'code' => 'INVALID_ORDER', 'message' => $error->getMessage()], 422);
    agentos_safe_exception($error);
}
