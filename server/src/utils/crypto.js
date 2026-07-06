/**
 * Cryptographic utilities for secure credential generation
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 12;

/**
 * Generate cryptographically secure random password
 * @param {number} length - Password length
 * @returns {string} Secure random password
 */
const generateSecurePassword = (length = 32) => {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    const bytes = crypto.randomBytes(length);
    let password = '';

    for (let i = 0; i < length; i++) {
        password += charset[bytes[i] % charset.length];
    }

    return password;
};

/**
 * Generate session token
 * @returns {string} JWT-compatible session ID
 */
const generateSessionToken = () => {
    return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password) => {
    return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Verify password against hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @returns {Promise<boolean>} Match result
 */
const verifyPassword = async (password, hash) => {
    return bcrypt.compare(password, hash);
};

/**
 * Generate MikroTik-compatible username from Firebase UID
 * @param {string} uid - Firebase user ID
 * @returns {string} MikroTik username
 */
const generateMikrotikUsername = (uid) => {
    // MikroTik has username length limits, so we hash the UID
    return `fb_${crypto.createHash('sha256').update(uid).digest('hex').substring(0, 20)}`;
};

/**
 * Encrypt sensitive data for storage
 * @param {string} text - Data to encrypt
 * @param {string} key - Encryption key
 * @returns {string} Encrypted data
 */
const encrypt = (text, key) => {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
};

/**
 * Decrypt sensitive data
 * @param {string} encryptedData - Data to decrypt
 * @param {string} key - Encryption key
 * @returns {string} Decrypted data
 */
const decrypt = (encryptedData, key) => {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

/**
 * Generate HMAC signature for webhook verification
 * @param {Object} payload - Webhook payload
 * @param {string} secret - Webhook secret
 * @returns {string} HMAC signature
 */
const generateWebhookSignature = (payload, secret) => {
    return crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(payload))
        .digest('hex');
};

/**
 * Verify webhook signature
 * @param {Object} payload - Webhook payload
 * @param {string} signature - Received signature
 * @param {string} secret - Webhook secret
 * @returns {boolean} Validity
 */
const verifyWebhookSignature = (payload, signature, secret) => {
    const expected = generateWebhookSignature(payload, secret);
    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
    );
};

module.exports = {
    generateSecurePassword,
    generateSessionToken,
    hashPassword,
    verifyPassword,
    generateMikrotikUsername,
    encrypt,
    decrypt,
    generateWebhookSignature,
    verifyWebhookSignature
};