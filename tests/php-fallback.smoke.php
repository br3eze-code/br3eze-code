<?php
declare(strict_types=1);

putenv('AGENTOS_PHP_SQLITE_PATH=' . sys_get_temp_dir() . '/agentos-php-smoke-' . getmypid() . '.sqlite');
$_SERVER['HTTP_X_AGENTOS_USER_ID'] = 'user-smoke';
$_SERVER['HTTP_X_AGENTOS_TENANT_ID'] = 'tenant-smoke';
$_SERVER['HTTP_X_AGENTOS_SITE_ID'] = 'site-smoke';
$_SERVER['HTTP_X_AGENTOS_LOCATION_PERMISSION'] = 'denied';
$_SERVER['HTTP_IDEMPOTENCY_KEY'] = 'smoke-key-1234';

require __DIR__ . '/../www/agentos_fallback.php';
require __DIR__ . '/../www/database_config.php';

$context = agentos_context(true);
assert($context['userId'] === 'user-smoke');
assert($context['tenantId'] === 'tenant-smoke');
assert($context['siteId'] === 'site-smoke');
assert($context['location']['available'] === false);
assert(agentos_idempotency_key() === 'smoke-key-1234');

$config = require __DIR__ . '/../www/config.php';
assert($config['mikrotik']['pass'] === '');
assert($pdo instanceof PDO);

echo "php-fallback-smoke=pass\n";
