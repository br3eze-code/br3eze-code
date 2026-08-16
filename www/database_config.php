<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';
$driver = strtolower(getenv('AGENTOS_DB_DRIVER') ?: 'sqlite');

if ($driver === 'mysql' && extension_loaded('pdo_mysql')) {
    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        $config['db']['host'],
        $config['db']['name']
    );
    $pdo = new PDO($dsn, $config['db']['user'], $config['db']['pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} else {
    $dataDir = getenv('AGENTOS_PHP_DATA_DIR') ?: (__DIR__ . '/../data');
    if (!is_dir($dataDir)) @mkdir($dataDir, 0700, true);
    $dbPath = getenv('AGENTOS_PHP_SQLITE_PATH') ?: ($dataDir . '/agentos-fallback.sqlite');
    $pdo = new PDO('sqlite:' . $dbPath);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
}

function agentos_has_column(PDO $pdo, string $table, string $column): bool
{
    $driver = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME);
    if ($driver === 'sqlite') {
        $statement = $pdo->query('PRAGMA table_info(' . preg_replace('/[^A-Za-z0-9_]/', '', $table) . ')');
        foreach ($statement->fetchAll() as $field) {
            if (($field['name'] ?? '') === $column) return true;
        }
        return false;
    }

    $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?');
    $statement->execute([$table, $column]);
    return (int) $statement->fetchColumn() > 0;
}

function agentos_add_column(PDO $pdo, string $table, string $column, string $definition): void
{
    if (!agentos_has_column($pdo, $table, $column)) {
        $safeTable = preg_replace('/[^A-Za-z0-9_]/', '', $table);
        $safeColumn = preg_replace('/[^A-Za-z0-9_]/', '', $column);
        $pdo->exec("ALTER TABLE {$safeTable} ADD COLUMN {$safeColumn} {$definition}");
    }
}

try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        site_id TEXT,
        name TEXT NOT NULL,
        price_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        price_id TEXT,
        mikrotik_profile TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        site_id TEXT,
        product_id INTEGER NOT NULL,
        amount_cents INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        payment_method TEXT NOT NULL,
        status TEXT NOT NULL,
        payment_reference TEXT,
        provider_event_id TEXT,
        idempotency_key TEXT UNIQUE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS webhook_events (
        provider TEXT NOT NULL,
        event_id TEXT NOT NULL,
        received_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (provider, event_id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS vouchers (
        code TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unused',
        used_by_username TEXT,
        used_at TEXT
    )");

    agentos_add_column($pdo, 'products', 'tenant_id', "TEXT NOT NULL DEFAULT 'default'");
    agentos_add_column($pdo, 'products', 'site_id', 'TEXT');
    agentos_add_column($pdo, 'products', 'currency', "TEXT NOT NULL DEFAULT 'USD'");
    agentos_add_column($pdo, 'products', 'active', 'INTEGER NOT NULL DEFAULT 1');
    agentos_add_column($pdo, 'transactions', 'tenant_id', "TEXT NOT NULL DEFAULT 'default'");
    agentos_add_column($pdo, 'transactions', 'site_id', 'TEXT');
    agentos_add_column($pdo, 'transactions', 'currency', "TEXT NOT NULL DEFAULT 'USD'");
    agentos_add_column($pdo, 'transactions', 'provider_event_id', 'TEXT');
} catch (Throwable $error) {
    error_log('[AgentOS PHP fallback] database bootstrap: ' . $error->getMessage());
}

