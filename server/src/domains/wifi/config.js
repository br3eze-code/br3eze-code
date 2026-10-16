/**
 * Wi-Fi product configuration.
 *
 * Kept outside the generic HTTP/runtime core so product-specific names,
 * router settings, voucher plans, and limits can be replaced by another
 * domain without changing the transport foundation.
 */
import crypto from 'crypto';

const BRAND = {
    name: 'AgentOS WiFi',
    version: '2026.5.0',
    emoji: '🤖'
};

const CONFIG = {
    PORT: parseInt(process.env.PORT || '3000'),
    HOST: process.env.HOST || '0.0.0.0',
    MIKROTIK_IP: process.env.MIKROTIK_IP || '192.168.88.1',
    MIKROTIK_USER: process.env.MIKROTIK_USER || 'admin',
    MIKROTIK_PASS: process.env.MIKROTIK_PASS || '',
    MIKROTIK_PORT: parseInt(process.env.MIKROTIK_PORT || '8728'),
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
    ALLOWED_CHAT_IDS: (process.env.ALLOWED_CHAT_IDS || '').split(',').filter(Boolean),
    GATEWAY_TOKEN: process.env.GATEWAY_TOKEN || crypto.randomBytes(32).toString('hex'),
    VOUCHER_PREFIX: 'STAR-',
    VOUCHER_PLANS: {
        '1hour': { duration: 60 * 60 * 1000, price: 1.00 },
        '1Day': { duration: 24 * 60 * 60 * 1000, price: 5.00 },
        '7Day': { duration: 7 * 24 * 60 * 60 * 1000, price: 25.00 },
        '30Day': { duration: 30 * 24 * 60 * 60 * 1000, price: 80.00 }
    },
    RATE_LIMIT: {
        WINDOW: 15 * 60 * 1000,
        MAX: 100
    }
};

if (!CONFIG.MIKROTIK_PASS) {
    console.warn('⚠️  Warning: MIKROTIK_PASS not set - router features disabled');
}

export { BRAND, CONFIG };
