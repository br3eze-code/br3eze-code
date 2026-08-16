<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/database_config.php';

$autoload = __DIR__ . '/vendor/autoload.php';
if (is_file($autoload)) require_once $autoload;

use RouterOS\Client;
use RouterOS\Query;

function agentos_mikrotik_config(): array
{
    $config = require __DIR__ . '/config.php';
    return $config['mikrotik'] ?? [];
}

function connectToMikrotik(): object
{
    $config = agentos_mikrotik_config();
    if (empty($config['host']) || empty($config['user']) || empty($config['pass'])) {
        throw new RuntimeException('MIKROTIK_NOT_CONFIGURED');
    }
    if (!class_exists(Client::class) || !class_exists(Query::class)) {
        throw new RuntimeException('MIKROTIK_ADAPTER_UNAVAILABLE');
    }
    return new Client([
        'host' => $config['host'],
        'user' => $config['user'],
        'pass' => $config['pass'],
        'port' => (int) ($config['port'] ?? 8728),
    ]);
}

function createUserOnMikroTik(string $username, string $password, string $profile = 'default'): array
{
    try {
        $client = connectToMikrotik();
        $existing = $client->query((new Query('/ip/hotspot/user/print'))->where('name', $username))->read();
        if (!empty($existing)) return ['success' => false, 'code' => 'ALREADY_EXISTS', 'message' => 'User already exists.'];
        $client->query((new Query('/ip/hotspot/user/add'))
            ->equal('name', $username)
            ->equal('password', $password)
            ->equal('profile', $profile))->read();
        return ['success' => true, 'message' => 'User created.'];
    } catch (Throwable $error) {
        if ($error->getMessage() === 'MIKROTIK_NOT_CONFIGURED') return ['success' => false, 'code' => 'NOT_CONFIGURED', 'message' => 'Router integration is not configured.'];
        error_log('[AgentOS PHP fallback] MikroTik create failed: ' . $error->getMessage());
        return ['success' => false, 'code' => 'ROUTER_UNAVAILABLE', 'message' => 'Router operation unavailable.'];
    }
}

function updateUserProfileOnMikroTik(string $username, string $profile): array
{
    try {
        $client = connectToMikrotik();
        $response = $client->query((new Query('/ip/hotspot/user/print'))->where('name', $username))->read();
        if (empty($response)) return ['success' => false, 'code' => 'USER_NOT_FOUND', 'message' => 'User not found on router.'];
        $client->query((new Query('/ip/hotspot/user/set'))->equal('.id', $response[0]['.id'])->equal('profile', $profile))->read();
        return ['success' => true, 'message' => 'User profile updated.'];
    } catch (Throwable $error) {
        if ($error->getMessage() === 'MIKROTIK_NOT_CONFIGURED') return ['success' => false, 'code' => 'NOT_CONFIGURED', 'message' => 'Router integration is not configured.'];
        error_log('[AgentOS PHP fallback] MikroTik update failed: ' . $error->getMessage());
        return ['success' => false, 'code' => 'ROUTER_UNAVAILABLE', 'message' => 'Router operation unavailable.'];
    }
}

function handle_activate_voucher(): void
{
    global $pdo, $context;
    agentos_require_mutation_approval();
    $username = $context['userId'];
    $code = trim((string) agentos_input('code', ''));
    if ($code === '') agentos_json(['success' => false, 'code' => 'VOUCHER_REQUIRED', 'message' => 'Voucher code is required.'], 400);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT profile_name FROM vouchers WHERE code = ? AND status = 'unused'");
        $stmt->execute([$code]);
        $voucher = $stmt->fetch();
        if (!$voucher) throw new RuntimeException('INVALID_VOUCHER');

        $router = updateUserProfileOnMikroTik($username, (string) $voucher['profile_name']);
        if (!$router['success']) throw new RuntimeException((string) ($router['code'] ?? 'ROUTER_UNAVAILABLE'));

        $claim = $pdo->prepare("UPDATE vouchers SET status = 'used', used_by_username = ?, used_at = CURRENT_TIMESTAMP WHERE code = ? AND status = 'unused'");
        $claim->execute([$username, $code]);
        if ($claim->rowCount() !== 1) throw new RuntimeException('VOUCHER_ALREADY_CLAIMED');
        $pdo->commit();
        agentos_json(['success' => true, 'message' => 'Voucher activated.', 'traceId' => $context['traceId']]);
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        if ($error->getMessage() === 'INVALID_VOUCHER' || $error->getMessage() === 'VOUCHER_ALREADY_CLAIMED') {
            agentos_json(['success' => false, 'code' => $error->getMessage(), 'message' => 'Invalid or already used voucher.'], 409);
        }
        agentos_safe_exception($error);
    }
}
