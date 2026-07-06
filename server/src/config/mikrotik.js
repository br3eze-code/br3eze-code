/**
 * MikroTik Router Configuration
 */

const logger = require('../utils/logger');

const config = {
    // Primary router
    primary: {
        host: process.env.MIKROTIK_HOST || '10.5.50.1',
        port: parseInt(process.env.MIKROTIK_API_PORT) || 8728,
        user: process.env.MIKROTIK_USER || 'admin',
        password: process.env.MIKROTIK_PASSWORD,
        useTLS: process.env.MIKROTIK_USE_TLS === 'true',
        timeout: parseInt(process.env.MIKROTIK_TIMEOUT) || 10000
    },

    // REST API configuration (for newer RouterOS)
    restApi: {
        baseUrl: process.env.MIKROTIK_REST_URL || 'https://10.5.50.1/rest',
        user: process.env.MIKROTIK_USER || 'admin',
        password: process.env.MIKROTIK_PASSWORD,
        rejectUnauthorized: process.env.MIKROTIK_VERIFY_SSL !== 'true' // Default false for self-signed
    },

    // Hotspot configuration
    hotspot: {
        dnsName: process.env.HOTSPOT_DNS_NAME || 'wifi.local',
        htmlDirectory: process.env.HOTSPOT_HTML_DIR || 'hotspot',
        loginBy: process.env.HOTSPOT_LOGIN_METHODS || 'http-chap,https',
        defaultProfile: process.env.HOTSPOT_DEFAULT_PROFILE || 'default',
        sessionTimeout: process.env.HOTSPOT_SESSION_TIMEOUT || '8h',
        idleTimeout: process.env.HOTSPOT_IDLE_TIMEOUT || '10m',
        keepaliveTimeout: process.env.HOTSPOT_KEEPALIVE || '5m'
    },

    // Walled garden (allowed hosts before auth)
    walledGarden: [
        '*.googleapis.com',
        '*.google.com',
        '*.gstatic.com',
        '*.firebaseapp.com',
        '*.firebaseio.com',
        'identitytoolkit.googleapis.com',
        'securetoken.googleapis.com',
        process.env.SERVER_DOMAIN || 'auth.local',
        'fonts.googleapis.com',
        'fonts.gstatic.com'
    ]
};

// Validate configuration
const validateConfig = () => {
    const required = ['MIKROTIK_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_PATH'];
    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        logger.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
        process.exit(1);
    }
};

validateConfig();

module.exports = config;