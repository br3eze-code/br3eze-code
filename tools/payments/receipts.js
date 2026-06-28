// tools/payments/receipts.js
// Payment Receipt Database Layer — CJS

'use strict';

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

const db = new Database('agentos.db');

db.exec(`
CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  reference TEXT UNIQUE,
  username TEXT,
  method TEXT,
  amount REAL,
  currency TEXT DEFAULT 'USD',
  plan TEXT,
  voucherCode TEXT,
  status TEXT DEFAULT 'paid',
  createdAt TEXT,
  metadata TEXT
);
`);

function generateReference() {
    const prefix = 'STAR';
    const time = Date.now().toString(36).toUpperCase();
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}-${time}-${rand}`;
}

function getReceipt(reference) {
    return db.prepare('SELECT * FROM receipts WHERE reference = ?').get(reference) || null;
}

function createReceipt({ username, method, amount, currency = 'USD', plan, voucherCode = null, metadata = {} }) {
    const reference = generateReference();
    const now = new Date().toISOString();
    db.prepare(`
        INSERT INTO receipts (id, reference, username, method, amount, currency, plan, voucherCode, status, createdAt, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), reference, username, method, amount, currency, plan, voucherCode, 'paid', now, JSON.stringify(metadata));
    return getReceipt(reference);
}

function getReceiptsByUser(username) {
    return db.prepare('SELECT * FROM receipts WHERE username = ? ORDER BY createdAt DESC').all(username);
}

function updateReceiptStatus(reference, status) {
    db.prepare('UPDATE receipts SET status = ? WHERE reference = ?').run(status, reference);
    return getReceipt(reference);
}

function getPendingReceipts() {
    return db.prepare("SELECT * FROM receipts WHERE status = 'pending'").all();
}

function listReceipts() {
    return db.prepare('SELECT * FROM receipts ORDER BY createdAt DESC').all();
}

function deleteReceipt(reference) {
    db.prepare('DELETE FROM receipts WHERE reference = ?').run(reference);
    return { success: true };
}

function getReceiptsByVoucher(voucherCode) {
    return db.prepare('SELECT * FROM receipts WHERE voucherCode = ? ORDER BY createdAt DESC').all(voucherCode);
}

function getReceiptsByDateRange(startDate, endDate) {
    return db.prepare('SELECT * FROM receipts WHERE createdAt BETWEEN ? AND ? ORDER BY createdAt DESC').all(startDate, endDate);
}

function getReceiptsByMethod(method) {
    return db.prepare('SELECT * FROM receipts WHERE method = ? ORDER BY createdAt DESC').all(method);
}

function getReceiptsByPlan(plan) {
    return db.prepare('SELECT * FROM receipts WHERE plan = ? ORDER BY createdAt DESC').all(plan);
}

function getReceiptsByStatus(status) {
    return db.prepare('SELECT * FROM receipts WHERE status = ? ORDER BY createdAt DESC').all(status);
}

function getReceiptsByAmountRange(minAmount, maxAmount) {
    return db.prepare('SELECT * FROM receipts WHERE amount BETWEEN ? AND ? ORDER BY createdAt DESC').all(minAmount, maxAmount);
}

function getReceiptsByCurrency(currency) {
    return db.prepare('SELECT * FROM receipts WHERE currency = ? ORDER BY createdAt DESC').all(currency);
}

function formatReceipt(reference) {
    const r = getReceipt(reference);
    if (!r) return 'Receipt not found';
    return (
        `🧾 PAYMENT RECEIPT\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `Ref: ${r.reference}\n` +
        `User: ${r.username}\n` +
        `Plan: ${r.plan}\n` +
        `Method: ${r.method}\n` +
        `Amount: ${r.currency} ${r.amount}\n` +
        `Status: ${r.status}\n` +
        `Date: ${r.createdAt}\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `Thank you for using AgentOS`
    );
}

module.exports = {
    createReceipt,
    getReceipt,
    getReceiptsByUser,
    updateReceiptStatus,
    getPendingReceipts,
    listReceipts,
    deleteReceipt,
    getReceiptsByVoucher,
    getReceiptsByDateRange,
    getReceiptsByMethod,
    getReceiptsByPlan,
    getReceiptsByStatus,
    getReceiptsByAmountRange,
    getReceiptsByCurrency,
    formatReceipt
};
