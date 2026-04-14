// src/core/channels/ChannelManager.js
const EventEmitter = require('events');

class ChannelManager extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.channels = new Map();
  }

  async initialize() {
    // Channels are registered dynamically based on config
  }

  async register(channelConfig) {
    const { type, config } = channelConfig;
    
    let ChannelClass;
    switch (type) {
      case 'telegram':
        ChannelClass = require('./TelegramChannel');
        break;
      case 'whatsapp':
        ChannelClass = require('./WhatsAppChannel');
        break;
      case 'websocket':
        ChannelClass = require('./WebSocketChannel');
        break;
      case 'slack':
        ChannelClass = require('./SlackChannel');
        break;
      case 'discord':
        ChannelClass = require('./DiscordChannel');
        break;
      case 'cli':
        ChannelClass = require('./CLIChannel');
        break;
      default:
        throw new Error(`Unknown channel type: ${type}`);
    }

    const channel = new ChannelClass(config, this.agent);
    
    // Setup message handler
    channel.on('message', async (msg) => {
      const result = await this.agent.processInteraction(msg, {
        channel: type,
        channelId: channel.id
      });
      
      // Send response back through same channel
      await channel.send(msg.userId, this.formatResponse(result));
    });

    // Forward special events (QR, status updates, commands, etc.)
    channel.on('qr', (qr) => {
      this.emit('qr', { channel: type, qr });
    });

    channel.on('command', (cmd) => {
      this.emit('command', { channel: type, ...cmd });
    });

    channel.on('status', (status) => {
      this.emit('status', { channel: type, status });
    });

    await channel.initialize();
    this.channels.set(type, channel);
    
    this.emit('channelRegistered', type);
  }

  formatResponse(result) {
    if (!result.success) {
      return {
        text: `❌ ${result.error}`,
        suggestions: result.help ? [result.help] : undefined
      };
    }

    return {
      text: result.result?.text || JSON.stringify(result.result),
      buttons: result.result?.buttons,
      metadata: result.metadata
    };
  }

  async send(channelType, userId, message) {
    const channel = this.channels.get(channelType);
    if (!channel) {
      throw new Error(`Channel not registered: ${channelType}`);
    }
    return channel.send(userId, message);
  }

  async broadcast(message, filter = null) {
    const promises = [];
    for (const [type, channel] of this.channels) {
      if (filter && !filter(type)) continue;
      promises.push(channel.broadcast(message));
    }
    return Promise.allSettled(promises);
  }

  getStatus() {
    const status = {};
    for (const [type, channel] of this.channels) {
      status[type] = channel.getStatus();
    }
    return status;
  }

  async closeAll() {
    for (const [type, channel] of this.channels) {
      try {
        await channel.destroy();
      } catch (error) {
        console.error(`Error closing channel ${type}:`, error);
      }
    }
    this.channels.clear();
  }
}

module.exports = ChannelManager;

