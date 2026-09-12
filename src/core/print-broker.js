import crypto from 'node:crypto';
import { logger } from './logger.js';

const DEFAULT_JOB_TIMEOUT_MS = 20000;

/**
 * Domain-neutral job broker. A concrete output adapter is injected by the
 * composition root; the kernel never knows what is being printed or by which
 * hardware/protocol.
 */
class PrintBroker {
  constructor({ outputAdapter = null, clock = () => Date.now() } = {}) { this.outputAdapter = outputAdapter; this.clock = clock; this.wsChannel = null; this.pending = new Map(); }
  static getInstance(options = {}) { if (!PrintBroker._instance) PrintBroker._instance = new PrintBroker(options); return PrintBroker._instance; }
  attachWebSocketChannel(wsChannel) { if (!wsChannel || typeof wsChannel.sendToWs !== 'function' || !(wsChannel.clients instanceof Map)) { logger.warn('Invalid output channel — skipping attachment'); return; } this.wsChannel = wsChannel; }
  getClientStatus(scope = null) { if (!this.wsChannel || !scope?.tenantId || !scope?.siteId) return { count: 0, clients: [], reason: 'output_scope_required' }; const clients = []; for (const [clientId, client] of this.wsChannel.clients) { const capability = client.capabilities?.output; const authority = client.authorityContext; if (capability && authority?.tenantId === scope.tenantId && authority?.siteId === scope.siteId && (authority.capabilities?.includes?.('output.write') || authority.capabilities?.includes?.('write'))) clients.push({ clientId, platform: client.platform || 'unknown', model: client.outputModel || null, capability }); } return { count: clients.length, clients }; }
  async send(payload, opts = {}) { const { preferClient = true, timeoutMs = DEFAULT_JOB_TIMEOUT_MS, scope = null } = opts; if (preferClient && this.wsChannel && scope?.tenantId && scope?.siteId) { const target = this.getClientStatus(scope).clients[0]; const client = target && this.wsChannel.clients.get(target.clientId); if (client?.ws) try { await this._sendClientJob(client.ws, payload, timeoutMs, target.clientId); return { success: true, via: 'client' }; } catch (error) { logger.warn(`Output client failed (${error.message}); falling back to adapter`); } } if (!this.outputAdapter?.send) throw new Error('No output adapter configured'); return { ...(await this.outputAdapter.send(payload, opts)), via: 'adapter' }; }
  async print(payload, opts = {}) { return this.send(payload, opts); }
  _sendClientJob(ws, payload, timeoutMs, clientId) { const jobId = crypto.randomUUID(); return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(jobId); reject(new Error('Output job timed out')); }, timeoutMs); this.pending.set(jobId, { resolve, reject, timer, clientId }); this.wsChannel.sendToWs(ws, { type: 'output.job', jobId, payload }); }); }
  handleAck({ jobId, clientId, success, error }) { const pending = this.pending.get(jobId); if (!pending) return; if (pending.clientId && pending.clientId !== clientId) return; clearTimeout(pending.timer); this.pending.delete(jobId); success ? pending.resolve() : pending.reject(new Error(error || 'Output operation failed')); }
  _handleMobileAck(args) { return this.handleAck(args); }
}

export { PrintBroker };
export default PrintBroker;
