'use strict';
/**
 * PrintBroker — routes a voucher print job to a connected mobile (Cordova/Android)
 * BLE/USB thermal-printer client over the WebSocket channel, falling back to the
 * server's own thermal printer (printer.js:_printVoucherDirect) when no mobile
 * client is registered or the mobile job fails/times out.
 *
 * Protocol (see WebSocketChannel.js handleLegacyMessage):
 *   client -> server  'printer.register' { capability, platform, model }
 *   server -> client  'print.job'        { jobId, payload: voucherData }
 *   client -> server  'print.result'     { jobId, success, error? }
 */

const crypto = require('crypto');
const { logger } = require('./logger');

const DEFAULT_JOB_TIMEOUT_MS = 20000;

class PrintBroker {
  constructor() {
    this.wsChannel = null; // {clients: Map<clientId, {ws, capabilities, platform, printerModel}>, sendToWs(ws, data)}
    this.pending = new Map(); // jobId -> { resolve, reject, timer }
  }

  static getInstance() {
    if (!PrintBroker._instance) PrintBroker._instance = new PrintBroker();
    return PrintBroker._instance;
  }

  attachWebSocketChannel(wsChannel) {
    if (!wsChannel || typeof wsChannel.sendToWs !== 'function' || !(wsChannel.clients instanceof Map)) {
      logger.warn('[PrintBroker] attachWebSocketChannel: invalid channel (expected {clients: Map, sendToWs()}) — skipping');
      return;
    }
    this.wsChannel = wsChannel;
  }

  /** { count, clients: [{ clientId, platform, model, capability }] } */
  getMobileClientStatus() {
    if (!this.wsChannel) return { count: 0, clients: [] };
    const clients = [];
    for (const [clientId, client] of this.wsChannel.clients) {
      const capability = client.capabilities?.printer;
      if (capability) {
        clients.push({ clientId, platform: client.platform || 'android', model: client.printerModel || null, capability });
      }
    }
    return { count: clients.length, clients };
  }

  /** Returns { success, via: 'mobile'|'server', error? } */
  async print(voucherData, opts = {}) {
    const { preferMobile = true, timeoutMs = DEFAULT_JOB_TIMEOUT_MS } = opts;

    if (preferMobile && this.wsChannel) {
      const status = this.getMobileClientStatus();
      const target = status.clients[0];
      const client = target && this.wsChannel.clients.get(target.clientId);
      if (client?.ws) {
        try {
          await this._sendMobileJob(client.ws, voucherData, timeoutMs);
          return { success: true, via: 'mobile' };
        } catch (e) {
          logger.warn(`[PrintBroker] Mobile print failed (${e.message}) — falling back to server printer`);
        }
      }
    }

    const { _printVoucherDirect } = require('./printer');
    const serverResult = await _printVoucherDirect(voucherData);
    return { ...serverResult, via: 'server' };
  }

  _sendMobileJob(ws, voucherData, timeoutMs) {
    const jobId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(jobId);
        reject(new Error('Mobile print job timed out'));
      }, timeoutMs);
      this.pending.set(jobId, { resolve, reject, timer });
      this.wsChannel.sendToWs(ws, { type: 'print.job', jobId, payload: voucherData });
    });
  }

  _handleMobileAck({ jobId, success, error }) {
    const pending = this.pending.get(jobId);
    if (!pending) return; // unknown or late ack — ignore
    clearTimeout(pending.timer);
    this.pending.delete(jobId);
    if (success) pending.resolve();
    else pending.reject(new Error(error || 'Mobile print reported failure'));
  }
}

module.exports = { PrintBroker };
