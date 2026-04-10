/**
 * Helper utilities
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} Formatted string
 */
const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format uptime seconds to readable string
 * @param {number} seconds - Uptime in seconds
 * @returns {string} Formatted uptime
 */
const formatUptime = (seconds) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

/**
 * Parse MikroTik time format (e.g., "1w2d3h4m5s")
 * @param {string} timeStr - MikroTik time string
 * @returns {number} Seconds
 */
const parseMikrotikTime = (timeStr) => {
    if (!timeStr) return 0;

    let seconds = 0;
    const units = {
        w: 604800,
        d: 86400,
        h: 3600,
        m: 60,
        s: 1
    };

    const matches = timeStr.match(/(\d+)([wdhms])/g) || [];

    matches.forEach(match => {
        const value = parseInt(match.slice(0, -1));
        const unit = match.slice(-1);
        seconds += value * units[unit];
    });

    return seconds;
};

/**
 * Sanitize MAC address format
 * @param {string} mac - MAC address
 * @returns {string} Standardized MAC (AA:BB:CC:DD:EE:FF)
 */
const sanitizeMacAddress = (mac) => {
    if (!mac) return null;
    return mac
        .toUpperCase()
        .replace(/[^0-9A-F]/g, '')
        .match(/.{1,2}/g)
        .join(':');
};

/**
 * Generate unique session ID
 * @returns {string} Session ID
 */
const generateSessionId = () => {
    return uuidv4().replace(/-/g, '');
};

/**
 * Deep merge objects
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} Merged object
 */
const deepMerge = (target, source) => {
    const output = Object.assign({}, target);

    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                } else {
                    output[key] = deepMerge(target[key], source[key]);
                }
            } else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }

    return output;
};

const isObject = (item) => {
    return item && typeof item === 'object' && !Array.isArray(item);
};

/**
 * Rate limiter key generator
 * @param {Object} req - Express request
 * @returns {string} Rate limit key
 */
const rateLimitKeyGenerator = (req) => {
    return req.ip || req.headers['x-forwarded-for'] || 'unknown';
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} Validity
 */
const isValidEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
};

/**
 * Sleep/delay utility
 * @param {number} ms - Milliseconds
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum retries
 * @param {number} delay - Initial delay
 * @returns {Promise<any>}
 */
const retryWithBackoff = async (fn, maxRetries = 3, delay = 1000) => {
    let lastError;

    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const backoffDelay = delay * Math.pow(2, i);
            await sleep(backoffDelay);
        }
    }

    throw lastError;
};

module.exports = {
    formatBytes,
    formatUptime,
    parseMikrotikTime,
    sanitizeMacAddress,
    generateSessionId,
    deepMerge,
    rateLimitKeyGenerator,
    isValidEmail,
    sleep,
    retryWithBackoff
};