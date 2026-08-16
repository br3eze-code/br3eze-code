<?php
declare(strict_types=1);

require_once __DIR__ . '/agentos_fallback.php';
require_once __DIR__ . '/mikrotik_functions.php';

$context = agentos_context(true);
handle_activate_voucher();
