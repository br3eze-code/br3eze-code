import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import { logger } from './logger.js';

/**
 * SecurityManager — HTTP hardening, audit logging and authenticated encryption.
 *
 * AES-256-GCM is used with a fresh IV for every ciphertext. If a master key is
 * configured it is deterministically normalized to 32 bytes so encrypted data
 * survives process restarts. Without one, a random process key is used and a
 * warning is emitted because ciphertext cannot be decrypted after restart.
 */
class SecurityManager {
  constructor() {
    const configuredKey = process.env.AGENTOS_MASTER_KEY;
    if (configuredKey) {
      this.encryptionKey = SecurityManager.normalizeKey(configuredKey);
    } else {
      this.encryptionKey = crypto.randomBytes(32);
      logger.warn('[Security] AGENTOS_MASTER_KEY is not configured; encryption key is ephemeral for this process.');
    }
    this.failedAttempts = new Map();
    this.blockedIPs = new Set();
  }

  static normalizeKey(value) {
    if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length >= 43) {
      const decoded = Buffer.from(value, 'base64');
      if (decoded.length === 32) return decoded;
    }
    return crypto.createHash('sha256').update(value, 'utf8').digest();
  }

  encrypt(text) {
    if (text === undefined || text === null) throw new TypeError('text is required');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(encryptedData) {
    if (typeof encryptedData !== 'string') throw new TypeError('encryptedData must be a string');
    const parts = encryptedData.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted data format');
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ciphertext = Buffer.from(encryptedHex, 'hex');
    if (iv.length !== 12 || authTag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid encrypted data');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  }

  sanitizeHost(host) {
    if (typeof host !== 'string' || !/^[\w\.-]+$/.test(host)) throw new Error('Invalid hostname format');
    if (['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(host.toLowerCase())) throw new Error('Forbidden host');
    return host;
  }

  getMessageLimiter() {
    return rateLimit({ windowMs: 60 * 1000, max: 30, message: 'Too many messages, please slow down', standardHeaders: true, legacyHeaders: false });
  }

  getSecurityMiddleware() {
    return [
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            connectSrc: ["'self'", 'wss:', 'https://*.firebaseio.com', 'wss://*.firebaseio.com', 'https://*.googleapis.com', 'https://*.firebaseapp.com'],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https://www.gstatic.com', 'https://apis.google.com'],
            frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://*.google.com'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
            imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com', 'https://*.gstatic.com', 'https://*.firebaseapp.com'],
          },
        },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      }),
      hpp(),
      this.auditMiddleware.bind(this),
    ];
  }

  auditMiddleware(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
      logger.audit('http_request', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: Date.now() - start,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        correlationId: req.correlationId,
        body: this.sanitizeBody(req.body),
      });
    });
    next();
  }

  sanitizeBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const sensitive = ['password', 'token', 'secret', 'key', 'credential', 'authorization'];
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [
      key,
      sensitive.some((name) => key.toLowerCase().includes(name)) ? '[REDACTED]' : value,
    ]));
  }
}

export default new SecurityManager();
