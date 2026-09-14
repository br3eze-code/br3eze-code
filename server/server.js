#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import Database from 'better-sqlite3';
import https from 'https';
import net from 'net';
import { db, admin } from './src/config/firebase.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ============================================================
// AgentOS WiFi Manager - Node.js Backend
// Version: 2026.5.0
// Architecture: Monolithic Tool Registry Pattern
// ============================================================

'use strict';
import 'dotenv/config';
import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import winston from 'winston';
import helmet from 'helmet';
import cors from 'cors';
import QRCode from 'qrcode';

// ============================================================
// §1 CONFIGURATION & CONSTANTS
// ============================================================

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

// ============================================================
// §2 LOGGER
// ============================================================

const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ level, message, timestamp }) =>
                    `${BRAND.emoji} [${BRAND.name}] ${timestamp} ${level}: ${message}`
                )
            )
        })
    ]
});

// ============================================================
// §3 DATABASE SERVICE
// ============================================================

class DatabaseService {
    constructor() {
        this.db = null;
        this.ready = false;
    }

    async initialize() {
        try {
            this.db = new Database('agentos.db');

            // Create tables
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT DEFAULT 'USER',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS vouchers (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE NOT NULL,
                    plan TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    expires_at DATETIME,
                    used INTEGER DEFAULT 0,
                    used_at DATETIME,
                    used_by TEXT,
                    created_by TEXT
                );

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    actor TEXT NOT NULL,
                    payload TEXT,
                    hash TEXT NOT NULL,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            `);

            // Never create a predictable/default administrator account.
            // Production/bootstrap credentials must be supplied explicitly through
            // ADMIN_BOOTSTRAP_USERNAME and ADMIN_BOOTSTRAP_PASSWORD.
            const bootstrapUsername = String(process.env.ADMIN_BOOTSTRAP_USERNAME || '').trim();
            const bootstrapPassword = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');

            if (bootstrapUsername && bootstrapPassword) {
                const existingAdmin = this.db.prepare(
                    'SELECT id FROM users WHERE username = ? AND role = ?'
                ).get(bootstrapUsername, 'ADMIN');

                const hash = crypto.createHash('sha256').update(bootstrapPassword).digest('hex');

                if (!existingAdmin) {
                    this.db.prepare(
                        'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)'
                    ).run(bootstrapUsername, hash, 'ADMIN');
                    logger.info('Configured bootstrap administrator created');
                } else {
                    this.db.prepare(
                        'UPDATE users SET password_hash = ?, role = ? WHERE id = ?'
                    ).run(hash, 'ADMIN', existingAdmin.id);
                    logger.info('Configured bootstrap administrator password synchronized');
                }
            } else {
                logger.info('No admin bootstrap credentials configured; no administrator account was created automatically');
            }

            this.ready = true;
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error('Database initialization failed:', error);
            throw error;
        }
    }

    // User methods
    getUser(username) {
        return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    }

    validateUser(username, password) {
        const user = this.getUser(username);
        if (!user) return null;
        const hash = crypto.createHash('sha256').update(password).digest('hex');
        return user.password_hash === hash ? user : null;
    }

    // Voucher methods
    createVoucher(code, plan, createdBy = 'system') {
        const expiresAt = new Date(Date.now() + CONFIG.VOUCHER_PLANS[plan]?.duration || 0).toISOString();
        const stmt = this.db.prepare(`
            INSERT INTO vouchers (code, plan, expires_at, created_by)
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(code, plan, expiresAt, createdBy);

        this.logAudit('voucher.create', createdBy, { code, plan });

        return { id: result.lastInsertRowid, code, plan, expires_at: expiresAt };
