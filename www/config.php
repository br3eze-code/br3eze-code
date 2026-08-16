<?php
declare(strict_types=1);

/**
 * Non-secret PHP fallback configuration.
 *
 * Credentials must be supplied by the deployment environment or a secret
 * manager. Never commit router, database, payment, or OAuth secrets here.
 */
return [
    'db' => [
        'host' => getenv('AGENTOS_DB_HOST') ?: '127.0.0.1',
        'user' => getenv('AGENTOS_DB_USER') ?: '',
        'pass' => getenv('AGENTOS_DB_PASSWORD') ?: '',
        'name' => getenv('AGENTOS_DB_NAME') ?: 'agentos',
    ],
    'mikrotik' => [
        'host' => getenv('AGENTOS_MIKROTIK_HOST') ?: '',
        'user' => getenv('AGENTOS_MIKROTIK_USER') ?: '',
        'pass' => getenv('AGENTOS_MIKROTIK_PASSWORD') ?: '',
        'port' => (int) (getenv('AGENTOS_MIKROTIK_PORT') ?: 8728),
    ],
    'app' => [
        'base_url' => getenv('AGENTOS_BASE_URL') ?: '',
        'environment' => getenv('AGENTOS_ENV') ?: 'production',
    ],
];
