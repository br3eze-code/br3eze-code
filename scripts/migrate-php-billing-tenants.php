<?php
declare(strict_types=1);

$options = getopt('', ['apply', 'default-tenant:', 'map:', 'help']);
if (isset($options['help'])) {
    fwrite(STDOUT, "Usage: php scripts/migrate-php-billing-tenants.php [--apply] [--default-tenant=TENANT] [--map=/path/map.json]\n");
    exit(0);
}

require __DIR__ . '/../www/database_config.php';

$defaultTenant = trim((string) ($options['default-tenant'] ?? getenv('AGENTOS_TENANT_BACKFILL_DEFAULT') ?: ''));
$mapPath = (string) ($options['map'] ?? getenv('AGENTOS_TENANT_BACKFILL_MAP') ?: '');
$map = [];
if ($mapPath !== '') {
    $decoded = json_decode((string) file_get_contents($mapPath), true);
    if (!is_array($decoded)) throw new RuntimeException('Tenant map must be a JSON object keyed by username.');
    $map = $decoded;
}

$rows = $pdo->query("SELECT id, username, tenant_id, site_id FROM transactions WHERE tenant_id IS NULL OR tenant_id = '' OR tenant_id = 'default' ORDER BY id")->fetchAll();
$updates = [];
$unresolved = [];
foreach ($rows as $row) {
    $entry = $map[(string) $row['username']] ?? null;
    $tenant = is_array($entry) ? trim((string) ($entry['tenant_id'] ?? '')) : (is_string($entry) ? trim($entry) : '');
    $site = is_array($entry) ? trim((string) ($entry['site_id'] ?? '')) : trim((string) ($row['site_id'] ?? ''));
    if ($tenant === '' && $defaultTenant !== '') $tenant = $defaultTenant;
    if ($tenant === '') {
        $unresolved[] = ['id' => (int) $row['id'], 'username' => (string) $row['username']];
        continue;
    }
    if (!preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $tenant) || ($site !== '' && !preg_match('/^[A-Za-z0-9._:-]{1,128}$/', $site))) {
        throw new RuntimeException('Invalid tenant or site mapping for transaction ' . $row['id']);
    }
    $updates[] = ['id' => (int) $row['id'], 'tenant_id' => $tenant, 'site_id' => $site !== '' ? $site : null];
}

fwrite(STDOUT, sprintf("Candidates: %d; updates: %d; unresolved: %d\n", count($rows), count($updates), count($unresolved)));
if ($unresolved) fwrite(STDOUT, json_encode(['unresolved' => $unresolved], JSON_PRETTY_PRINT) . "\n");
if (!isset($options['apply'])) {
    fwrite(STDOUT, "Dry run only. Re-run with --apply after reviewing mappings.\n");
    exit($unresolved ? 2 : 0);
}
if (getenv('AGENTOS_ALLOW_PRODUCTION_MIGRATION') !== '1') {
    fwrite(STDERR, "Refusing to apply: set AGENTOS_ALLOW_PRODUCTION_MIGRATION=1 after backup/approval.\n");
    exit(3);
}
if ($unresolved) {
    fwrite(STDERR, "Refusing to apply while unresolved transaction rows remain.\n");
    exit(4);
}

$pdo->beginTransaction();
try {
    $statement = $pdo->prepare('UPDATE transactions SET tenant_id = ?, site_id = ? WHERE id = ? AND (tenant_id IS NULL OR tenant_id = "" OR tenant_id = "default")');
    foreach ($updates as $update) $statement->execute([$update['tenant_id'], $update['site_id'], $update['id']]);
    $pdo->commit();
    fwrite(STDOUT, "Applied {$statement->rowCount()} final-row update(s).\n");
} catch (Throwable $error) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $error;
}
