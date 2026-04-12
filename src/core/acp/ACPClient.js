// src/core/acp/ACPClient.js
const WebSocket = require('ws');
const EventEmitter = require('events');

class ACPClient extends EventEmitter {
  constructor(agentId, endpoint) {
    super();
    this.agentId = agentId;
    this.endpoint = endpoint;
    this.ws = null;
    this.sessionState = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.endpoint}/agents/${this.agentId}`);
      
      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        this.emit('connected');
        resolve();
      });
      
      this.ws.on('message', (data) => {
        const message = JSON.parse(data);
        this.handleMessage(message);
      });
      
      this.ws.on('close', () => this.handleDisconnect());
      this.ws.on('error', (err) => reject(err));
    });
  }

  handleMessage(message) {
    switch (message.type) {
      case 'action':
        this.emit('action', message);
        break;
      case 'state_sync':
        this.sessionState = { ...this.sessionState, ...message.state };
        this.emit('stateUpdate', this.sessionState);
        break;
      case 'ping':
        this.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        this.emit('message', message);
    }
  }

  async sendAction(action, payload) {
    const message = {
      type: 'action',
      action,
      payload,
      timestamp: Date.now(),
      session: this.sessionState,
      agentId: this.agentId
    };
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      throw new Error('ACP client not connected');
    }
  }

  handleDisconnect() {
    this.emit('disconnected');
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    }
  }
}

module.exports = ACPClient;