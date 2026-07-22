'use strict';
/**
 * PrintBroker — Unified Print Routing Layer
 * ==========================================
 * Priority chain for every voucher print request:
 *
 *   1. Connected Android/Cordova WebSocket client with `capabilities.printer`
 *      → Sends a `print.voucher` command over WebSocket; the Cordova app uses
 *        its native BLE or USB plugin to drive the thermal printer.
 *
 *   2. Server-side printer (existing printer.js logic — BLE/USB COM port or
 *      Windows Spooler via PowerShell RawPrintV5).
 *
 * Usage:
 *   const { PrintBroker } = require('./print-broker');
 *   const broker = PrintBroker.getInstance();
 *   broker.attachWebSocketChannel(wsChannel);   // call once during gateway init
 *   const result = await broker.print(voucherData, { preferMobile: true });
 */

const { logger } = require('./logger');
// Use the raw hardware-only path to avoid circular routing through this broker
const { _printVoucherDirect: printVoucher } = require('./printer');

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance = null;

class PrintBroker {
    constructor() {
        /** @type {import('./channels/WebSocketChannel')|null} */
        this._wsChannel = null;

        /**
         * Pending mobile print promises keyed by a unique jobId.
         * Map<jobId, { resolve, reject, timer }>
         */
        this._pending = new Map();

        /** Rolling job counter */
        this._seq = 0;

        /** How long (ms) to wait for a mobile client to ACK a print job */
        this.MOBILE_TIMEOUT_MS = parseInt(process.env.MOBILE_PRINT_TIMEOUT_MS || '15000', 10);
    }

    static getInstance() {
        if (!_instance) _instance = new PrintBroker();
        return _instance;
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * Attach the live WebSocketChannel so PrintBroker can reach Cordova clients.
     * Called once during gateway/channel initialisation.
     * @param {import('./channels/WebSocketChannel')} wsChannel
     */
    attachWebSocketChannel(wsChannel) {
        this._wsChannel = wsChannel;

        // Listen for print result ACKs coming back from the mobile app
        wsChannel.on('message', (msg) => {
            if (msg?.raw?.type === 'print.result') {
                this._handleMobileAck(msg.raw);
            }
        });

        // Also handle legacy message format where the channel emits the raw WS message
        wsChannel.wss?.on('connection', () => {
            // Re-wire after each new connection (handles reconnects)
        });

        logger.info('[PrintBroker] Attached to WebSocketChannel');
    }

    // ── Core routing ──────────────────────────────────────────────────────────

    /**
     * Print a voucher via the best available interface.
     *
     * @param {object} voucherData  — { username, password, profile, loginUrl, ... }
     * @param {object} [opts]
     * @param {boolean} [opts.preferMobile=true]  — try mobile client first
     * @param {string}  [opts.clientId]            — target a specific WS client
     * @returns {Promise<{ success: boolean, via: string, error?: string }>}
     */
    async print(voucherData, opts = {}) {
        const preferMobile = opts.preferMobile !== false; // default true

        // ── Step 1: Try Android/Cordova client ────────────────────────────────
        if (preferMobile && this._wsChannel) {
            const mobileClient = this._selectMobileClient(opts.clientId);
            if (mobileClient) {
                try {
                    logger.info(`[PrintBroker] Routing print job to mobile client ${mobileClient.clientId}`);
                    const mobileResult = await this._printViaMobile(mobileClient, voucherData);
                    if (mobileResult.success) {
                        return { ...mobileResult, via: 'mobile' };
                    }
                    logger.warn(`[PrintBroker] Mobile print failed (${mobileResult.error}), falling back to server`);
                } catch (err) {
                    logger.warn(`[PrintBroker] Mobile print threw (${err.message}), falling back to server`);
                }
            } else {
                logger.debug('[PrintBroker] No mobile printer client available — using server printer');
            }
        }

        // ── Step 2: Server-side fallback ──────────────────────────────────────
        try {
            const serverResult = await printVoucher(voucherData);
            return { ...serverResult, via: 'server' };
        } catch (err) {
            return { success: false, via: 'server', error: err.message };
        }
    }

    // ── Mobile client selection ───────────────────────────────────────────────

    /**
     * Find the best connected Android/Cordova WebSocket client.
     * Preference: `capabilities.printer === 'ble'` > `'usb'` > `'any'` > generic
     *
     * @param {string} [preferredClientId]  — pin to a specific client if provided
     * @returns {{ clientId: string, ws: WebSocket, capabilities: object }|null}
     */
    _selectMobileClient(preferredClientId) {
        if (!this._wsChannel?.clients) return null;

        const candidates = [];

        for (const [clientId, client] of this._wsChannel.clients) {
            console.log(`CHECKING client: ${clientId}`, client ? { hasWs: !!client.ws, readyState: client.ws?.readyState } : 'null');
            if (!client?.ws) continue;
            const { WebSocket } = require('ws');
            console.log(`WebSocket.OPEN: ${WebSocket.OPEN}`);
            if (client.ws.readyState !== WebSocket.OPEN) continue;

            // If a specific client is requested, return it immediately (no cap check)
            if (preferredClientId && clientId === preferredClientId) {
                return { clientId, ...client };
            }

            // Only consider clients that declared printer capability
            const cap = client.capabilities?.printer;
            console.log(`cap: ${cap}`);
            if (cap) {
                candidates.push({ clientId, ...client, _cap: cap });
            }
        }

        console.log(`candidates length: ${candidates.length}`);
        if (candidates.length === 0) return null;

        // Sort: ble → usb → any → other
        const order = { ble: 0, usb: 1, any: 2 };
        candidates.sort((a, b) => (order[a._cap] ?? 99) - (order[b._cap] ?? 99));
        return candidates[0];
    }

    // ── Mobile print dispatch ─────────────────────────────────────────────────

    /**
     * Send a `print.voucher` message to the mobile client and await its ACK.
     * The Cordova app must respond with a `print.result` message.
     *
     * Expected Cordova → Server response shape:
     *   { type: 'print.result', jobId: '...', success: true|false, error?: '...' }
     *
     * @param {{ clientId: string, ws: WebSocket }} client
     * @param {object} voucherData
     * @returns {Promise<{ success: boolean, error?: string }>}
     */
    _printViaMobile(client, voucherData) {
        return new Promise((resolve, reject) => {
            const jobId = `pjob_${Date.now()}_${++this._seq}`;

            const timer = setTimeout(() => {
                this._pending.delete(jobId);
                reject(new Error(`Mobile print timeout after ${this.MOBILE_TIMEOUT_MS}ms`));
            }, this.MOBILE_TIMEOUT_MS);

            this._pending.set(jobId, { resolve, reject, timer });

            // Send the print command to the Cordova app
            const payload = JSON.stringify({
                type: 'print.voucher',
                jobId,
                voucher: {
                    username: voucherData.username,
                    password:  voucherData.password,
                    profile:   voucherData.profile,
                    loginUrl:  voucherData.loginUrl,
                    expires:   voucherData.expires,
                    price:     voucherData.price,
                    currency:  voucherData.currency,
                    duration:  voucherData.duration,
                },
                // Hints for the Cordova plugin to select BLE vs USB
                printerHint: client._cap || 'any',
                // ESC/POS config derived from config.xml / env
                printerConfig: this._buildPrinterConfig()
            });

            try {
                client.ws.send(payload);
                logger.debug(`[PrintBroker] Sent print.voucher job ${jobId} to client ${client.clientId}`);
            } catch (sendErr) {
                clearTimeout(timer);
                this._pending.delete(jobId);
                reject(sendErr);
            }
        });
    }

    /**
     * Handle a `print.result` ACK coming back from the Cordova app.
     * @param {{ jobId: string, success: boolean, error?: string }} msg
     */
    _handleMobileAck(msg) {
        const pending = this._pending.get(msg.jobId);
        if (!pending) return; // stale / unknown jobId

        clearTimeout(pending.timer);
        this._pending.delete(msg.jobId);

        if (msg.success) {
            logger.info(`[PrintBroker] Mobile print job ${msg.jobId} succeeded`);
            pending.resolve({ success: true });
        } else {
            logger.warn(`[PrintBroker] Mobile print job ${msg.jobId} failed: ${msg.error}`);
            pending.resolve({ success: false, error: msg.error || 'Mobile printer error' });
        }
    }

    // ── Config helper ─────────────────────────────────────────────────────────

    _buildPrinterConfig() {
        try {
            const { getConfig } = require('./config');
            const cfg = getConfig();
            return {
                model:  cfg.printer?.model  || process.env.PRINTER_MODEL  || 'generic',
                width:  cfg.printer?.width  || parseInt(process.env.PRINTER_WIDTH  || '80',  10),
                type:   cfg.printer?.type   || process.env.PRINTER_TYPE   || 'EPSON',
                timeout: cfg.printer?.timeout || 10000,
            };
        } catch (_) {
            return { model: 'generic', width: 80, type: 'EPSON', timeout: 10000 };
        }
    }

    // ── Status helpers ────────────────────────────────────────────────────────

    /**
     * Returns a human-readable status of connected print-capable clients.
     * Called by `/printer` Telegram handler.
     */
    getMobileClientStatus() {
        if (!this._wsChannel?.clients) {
            return { count: 0, clients: [] };
        }

        const { WebSocket } = require('ws');
        const clients = [];

        for (const [clientId, client] of this._wsChannel.clients) {
            if (!client?.ws || client.ws.readyState !== WebSocket.OPEN) continue;
            const cap = client.capabilities?.printer;
            if (cap) {
                clients.push({
                    clientId: clientId.substring(0, 8) + '…',
                    capability: cap,
                    platform: client.platform || 'unknown',
                });
            }
        }

        return { count: clients.length, clients };
    }
}

module.exports = { PrintBroker };
