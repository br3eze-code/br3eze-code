import crypto from 'node:crypto';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import hpp from 'hpp';
import { logger } from './logger.js';

// src/core/security.js

class SecurityManager {
  constructor() {
    this.encryptionKey = process.env.AGENTOS_MASTER_KEY || crypto.randomBytes(32);
    this.failedAttempts = new Map();
    this.blockedIPs = new Set();
  }

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.encryptionKey);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(encryptedData) {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
    const decipher = crypto.createDecipher('aes-256-gcm', this.encryptionKey);
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  sanitizeHost(host) {
    if (!/^[\w\.-]+$/.test(host)) throw new Error('Invalid hostname format');
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
    if (!body) return body;
    const sensitive = ['password', 'token', 'secret', 'key', 'credential'];
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [
      key,
      sensitive.some((name) => key.toLowerCase().includes(name)) ? '[REDACTED]' : value,
    ]));
  }
}

export default new SecurityManager();
