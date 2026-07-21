/**
 * HeartbeatAgent — the OpenClaw-style proactive loop.
 *
 * On a configurable interval the agent wakes itself up (no user prompt),
 * gathers a snapshot of the system, derives noteworthy signals (router down,
 * low stock, plans expiring, ageing tickets, pending COD orders), lets the LLM
 * compose a concise owner briefing, and pushes it to the owner's chat channel.
 *
 * v1 is NOTIFY-ONLY: it never performs write actions on its own — it only
 * observes and messages. Autonomous actions can be layered on later behind the
 * existing permission tiers.
 *
 * Config (env):
 *   HEARTBEAT_ENABLED=true
 *   HEARTBEAT_INTERVAL_MS=1800000        (default 30 min)
 *   HEARTBEAT_OWNER_CHANNEL=telegram      (channel to notify)
 *   HEARTBEAT_OWNER_ID=<chat id / jid>    (falls back to ALLOWED_CHAT_IDS[0])
 *   HEARTBEAT_QUIET_HOURS=22-7            (local hours to stay silent)
 */
'use strict';

import { logger } from './logger.js';

const DEFAULT_INTERVAL = 30 * 60 * 1000;

// ── Pure helpers (unit-testable, no I/O) ─────────────────────────────────────

/** Parse "22-7" → {start:22,end:7}; null when unset/invalid. */
function parseQuietHours(spec) {
    if (!spec) return null;
    const m = String(spec).match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
    if (!m) return null;
    return { start: Number(m[1]) % 24, end: Number(m[2]) % 24 };
}

/** Is `hour` (0-23) inside the quiet window? Handles overnight wrap (22-7). */
function inQuietHours(hour, quiet) {
    if (!quiet) return false;
    const { start, end } = quiet;
    if (start === end) return false;
    return start < end ? (hour >= start && hour < end) : (hour >= start || hour < end);
}

/**
 * Turn a raw context snapshot into prioritised signals.
 * Each signal: { key, severity: 'high'|'medium'|'low', text }.
 */
function deriveSignals(ctx = {}) {
    const out = [];
    if (ctx.routerConnected === false) {
        out.push({ key: 'router-down', severity: 'high', text: '🔴 Router is unreachable — hotspot users can\'t be provisioned.' });
    }
    for (const p of (ctx.lowStock || [])) {
        out.push({ key: `low-stock:${p.id}`, severity: (p.stock || 0) === 0 ? 'high' : 'medium', text: `📦 ${p.name}: ${(p.stock || 0) === 0 ? 'SOLD OUT' : `only ${p.stock} left`}.` });
    }
    for (const pl of (ctx.expiringPlans || [])) {
        out.push({ key: `expiring:${pl.userId}`, severity: 'low', text: `⏳ ${pl.name || 'A plan'} for ${pl.who || 'a user'} expires within 24h.` });
    }
    if (ctx.openTickets > 0) {
        out.push({ key: 'open-tickets', severity: ctx.openTickets >= 5 ? 'high' : 'medium', text: `🎫 ${ctx.openTickets} support ticket(s) still open.` });
    }
    if (ctx.pendingOrders > 0) {
        out.push({ key: 'pending-orders', severity: 'medium', text: `🛍️ ${ctx.pendingOrders} shop order(s) awaiting payment/fulfilment.` });
    }
    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

class HeartbeatAgent {
    constructor({ engine, channelManager, database, mikrotik, config } = {}) {
        this.engine = engine;                 // AskEngine (LLM) — optional
        this.channelManager = channelManager; // to send messages
        this.database = database;
        this.mikrotik = mikrotik;
        this.config = config || {};
        this.intervalMs = Number(process.env.HEARTBEAT_INTERVAL_MS) || DEFAULT_INTERVAL;
        this.quiet = parseQuietHours(process.env.HEARTBEAT_QUIET_HOURS);
        this.ownerChannel = process.env.HEARTBEAT_OWNER_CHANNEL || 'telegram';
        this.ownerId = process.env.HEARTBEAT_OWNER_ID ||
            (process.env.ALLOWED_CHAT_IDS ? process.env.ALLOWED_CHAT_IDS.split(',')[0].trim() : null);
        this._timer = null;
        this._sent = new Map();               // signal key -> last-notified ms
        this.DEDUPE_MS = 6 * 60 * 60 * 1000;  // don't repeat a signal within 6h
    }

    start() {
        if (process.env.HEARTBEAT_ENABLED !== 'true') {
            logger.info('[Heartbeat] disabled (set HEARTBEAT_ENABLED=true to enable).');
            return;
        }
        if (!this.ownerId) { logger.warn('[Heartbeat] no owner id — set HEARTBEAT_OWNER_ID or ALLOWED_CHAT_IDS.'); return; }
        logger.info(`[Heartbeat] proactive loop every ${Math.round(this.intervalMs / 60000)}min → ${this.ownerChannel}:${this.ownerId}`);
        this._timer = setInterval(() => this.tick().catch(e => logger.warn(`[Heartbeat] tick failed: ${e.message}`)), this.intervalMs);
        setTimeout(() => this.tick().catch(() => {}), 15000); // first check shortly after boot
    }

    stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

    async tick() {
        if (inQuietHours(new Date().getHours(), this.quiet)) { logger.debug('[Heartbeat] quiet hours — skipping.'); return; }

        const ctx = await this._gatherContext();
        let signals = deriveSignals(ctx);

        const t = Date.now();
        signals = signals.filter(s => {
            const last = this._sent.get(s.key);
            return !(last && (t - last) < this.DEDUPE_MS);
        });
        if (!signals.length) { logger.debug('[Heartbeat] nothing new to report.'); return; }

        const message = await this._compose(signals);
        await this._notifyOwner(message);
        signals.forEach(s => this._sent.set(s.key, t));
        logger.info(`[Heartbeat] briefed owner on ${signals.length} signal(s).`);
    }

    async _gatherContext() {
        const ctx = { routerConnected: null, lowStock: [], expiringPlans: [], openTickets: 0, pendingOrders: 0 };
        try { ctx.routerConnected = !!(this.mikrotik && this.mikrotik.state && this.mikrotik.state.isConnected); } catch (_) {}
        const fs = this.database && this.database.db;
        if (fs) {
            try {
                const ls = await fs.collection('products').where('active', '==', true).get();
                ctx.lowStock = ls.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => (p.stock || 0) <= 5).slice(0, 10);
            } catch (_) {}
            try { ctx.openTickets = (await fs.collection('tickets').where('status', '==', 'Open').get()).size; } catch (_) {}
            try { ctx.pendingOrders = (await fs.collection('orders').where('status', '==', 'pending_payment').get()).size; } catch (_) {}
        }
        return ctx;
    }

    /** LLM-composed briefing when available; deterministic digest otherwise. */
    async _compose(signals) {
        const bullets = signals.map(s => '• ' + s.text).join('\n');
        const fallback = `🤖 *AgentOS check-in*\n\n${bullets}`;
        if (!this.engine || typeof this.engine.run !== 'function' || this.engine.isRuleOnly) return fallback;
        try {
            const prompt = `You are AgentOS doing a proactive check-in for the owner. Turn these system signals into a short, friendly WhatsApp/Telegram briefing (2-4 lines, keep the key facts, no preamble):\n${bullets}`;
            const r = await this.engine.run(prompt);
            const text = typeof r?.result === 'string' ? r.result : null;
            return text && text.length > 8 ? text : fallback;
        } catch { return fallback; }
    }

    async _notifyOwner(text) {
        if (!this.channelManager || typeof this.channelManager.send !== 'function') {
            logger.warn('[Heartbeat] no channelManager — briefing not sent.');
            return;
        }
        await this.channelManager.send(this.ownerChannel, this.ownerId, { text });
    }
}

export { HeartbeatAgent, parseQuietHours, inQuietHours, deriveSignals };
