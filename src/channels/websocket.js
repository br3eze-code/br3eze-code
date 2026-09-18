import { BaseChannel } from './base.js';
import { Logger } from '../utils/logger.js';


/**
 * WebSocket Channel
 */


class WebSocketChannel extends BaseChannel {
  constructor(options = {}, services = {}) {
    super(options);
    this.name = 'websocket';
    this.logger = new Logger('WebSocketChannel');
    this.clients = new Map();
    this.database = services.database || options.database || null;
  }

  _normalizeAuthorityContext(context, userId) {
    if (!context?.tenantId) return null;
    const siteIds = context.authorizedSiteIds || context.siteIds || [];
    const routerIds = context.authorizedRouterIds || context.routerIds || [];
    if (context.siteId && siteIds.length && !siteIds.includes(context.siteId)) return null;
    if (context.routerId && routerIds.length && !routerIds.includes(context.routerId)) return null;
    return {
      source: 'server-membership', userId, tenantId: context.tenantId,
      siteId: context.siteId || siteIds[0] || null, routerId: context.routerId || routerIds[0] || null,
      authorizedSiteIds: [...siteIds], authorizedRouterIds: [...routerIds],
      roles: [...(context.roles || [])], capabilities: [...(context.capabilities || [])]
    };
  }

  async handleLegacyMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client || message?.type !== 'auth.identify') return;
    const userId = message.uid || message.userId;
    const authority = this._normalizeAuthorityContext(
      await this.database?.resolveAuthorityContext?.(userId), userId
    );
    if (!authority) {
      client.authorityContext = undefined;
      client.ws?.send(JSON.stringify({ type: 'auth.rejected', code: 'TENANT_AUTHORITY_REQUIRED' }));
      return;
    }
    client.authorityContext = authority;
    client.ws?.send(JSON.stringify({ type: 'auth.identified', authorityContext: authority }));
  }
  
  async connect() {
    // WebSocket is managed by Gateway
    this.connected = true;
  }
  
  async disconnect() {
    for (const [id, client] of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.connected = false;
  }
  
  registerClient(clientId, ws) {
    this.clients.set(clientId, ws);
    
    ws.on('close', () => {
      this.clients.delete(clientId);
    });
  }
  
  async send(recipient, message) {
    const client = this.clients.get(recipient);
    if (!client) {
      throw new Error(`WebSocket client not found: ${recipient}`);
    }
    
    if (client.readyState === 1) { // OPEN
      client.send(JSON.stringify(this.formatMessage(message)));
    }
  }
  
  formatMessage(message) {
    if (typeof message === 'string') {
      return { type: 'message', content: message };
    }
    return { type: 'response', ...message };
  }
}

export { WebSocketChannel };
