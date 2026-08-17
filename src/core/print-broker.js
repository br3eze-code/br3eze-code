import crypto from 'crypto';
import { logger } from './logger.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

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
  getMobileClientStatus(scope = null) {
    if (!this.wsChannel || !scope?.tenantId || !scope?.siteId) {
      return { count: 0, clients: [], reason: 'print_scope_required' };
    }
    const clients = [];
    for (const [clientId, client] of this.wsChannel.clients) {
      const capability = client.capabilities?.printer;
      const authority = client.authorityContext;
      const sameTenant = authority?.tenantId === scope.tenantId;
      const sameSite = authority?.siteId === scope.siteId;
      const canPrint = authority?.capabilities?.includes?.('printer.write') || authority?.capabilities?.includes?.('print.write');
      if (capability && sameTenant && sameSite && canPrint) {
        clients.push({ clientId, platform: client.platform || 'android', model: client.printerModel || null, capability });
      }
    }
    return { count: clients.length, clients };
  }

  /** Returns { success, via: 'mobile'|'server', error? } */
  async print(voucherData, opts = {}) {
    const { preferMobile = true, timeoutMs = DEFAULT_JOB_TIMEOUT_MS, scope = null } = opts;

    if (preferMobile && this.wsChannel && scope?.tenantId && scope?.siteId) {
      const status = this.getMobileClientStatus(scope);
      const target = status.clients[0];
      const client = target && this.wsChannel.clients.get(target.clientId);
      if (client?.ws) {
        try {
          await this._sendMobileJob(client.ws, voucherData, timeoutMs, target.clientId);
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

  _sendMobileJob(ws, voucherData, timeoutMs, clientId) {
    const jobId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(jobId);
        reject(new Error('Mobile print job timed out'));
      }, timeoutMs);
      this.pending.set(jobId, { resolve, reject, timer, clientId });
      this.wsChannel.sendToWs(ws, { type: 'print.job', jobId, payload: voucherData });
    });
  }

  _handleMobileAck({ jobId, clientId, success, error }) {
    const pending = this.pending.get(jobId);
    if (!pending) return; // unknown or late ack — ignore
    if (pending.clientId && pending.clientId !== clientId) {
      logger.warn(`[PrintBroker] Ignoring print ACK from non-originating client ${clientId || 'unknown'}`);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(jobId);
    if (success) pending.resolve();
    else pending.reject(new Error(error || 'Mobile print reported failure'));
  }
}

export { PrintBroker };
