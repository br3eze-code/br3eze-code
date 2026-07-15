import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { BaseChannel } from './BaseChannel.js';

// Statically import all known channel adapters so their self-registration
// (BaseChannel.register(...) at module top-level) runs on load, replacing
// the require()-per-file directory scan (real ESM has no synchronous
// dynamic require). A brand-new channel file needs a line here too.
import './CLIChannel.js';
import './DiscordChannel.js';
import './EmailChannel.js';
import './SMSChannel.js';
import './SlackChannel.js';
import './TelegramChannel.js';
import './USSDChannel.js';
import './WebSocketChannel.js';
import './WhatsappChannel.js';

class ChannelManager extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.channels = new Map();
  }

  async initialize() {
    logger.info('ChannelManager: Initializing channels from configuration...');

    const channelConfigs = this.agent.config.channels
      ? [...this.agent.config.channels]
      : [];

    // ── Fallback: detect channels from environment variables ────────────────
    if (channelConfigs.length === 0) {
      if (process.env.TELEGRAM_TOKEN) {
        channelConfigs.push({
          type: 'telegram',
          config: {
            token: process.env.TELEGRAM_TOKEN,
            allowed_ids: process.env.ALLOWED_CHAT_IDS
              ? process.env.ALLOWED_CHAT_IDS.split(',')
              : []
          }
        });
      }

      if (process.env.WHATSAPP_ENABLED === 'true') {
        channelConfigs.push({
          type: 'whatsapp',
          config: {
            enabled: true,
            authStateFolder: process.env.WHATSAPP_AUTH_DIR || './data/whatsapp_auth',
            allowed_ids: process.env.ALLOWED_CHAT_IDS
              ? process.env.ALLOWED_CHAT_IDS.split(',')
              : []
          }
        });
      }
    }

    // ── Auto-detect additional channels from root config ────────────────────
    const autoChannels = ['slack', 'discord', 'email', 'sms', 'ussd'];
    for (const type of autoChannels) {
      if (this.agent.config[type] && this.agent.config[type].enabled && !channelConfigs.find(c => c.type === type)) {
        channelConfigs.push({
          type,
          config: this.agent.config[type]
        });
      }
    }

    // ── CLI channel: opt-in via config.cli.enabled, AGENTOS_CLI_CHANNEL=true,
    //    or auto-enabled when running interactively in the foreground (a TTY,
    //    not a detached --daemon process) and not explicitly disabled ───────
    const cliExplicitlyDisabled = this.agent.config.cli?.enabled === false;
    const cliExplicitlyEnabled = this.agent.config.cli?.enabled === true || process.env.AGENTOS_CLI_CHANNEL === 'true';
    const cliInteractiveDefault = Boolean(process.stdin.isTTY) && !this.agent.config.daemon;
    if (!channelConfigs.find(c => c.type === 'cli') && !cliExplicitlyDisabled && (cliExplicitlyEnabled || cliInteractiveDefault)) {
      channelConfigs.push({ type: 'cli', config: this.agent.config.cli || {} });
    }

    for (const chan of channelConfigs) {
      logger.info(`ChannelManager: Registering ${chan.type} channel...`);
      await this.register(chan);
    }
  } // ← closes initialize()

  static registerAdapter(type, adapterClass) {
    ChannelManager.adapters.set(type, adapterClass);
  }

  async register(channelConfig) {
    const { type, config } = channelConfig;

    try {
      const ChannelClass = BaseChannel.getAdapter(type);
      if (!ChannelClass) {
        throw new Error(`Unknown or unregistered channel type: ${type}`);
      }

      // Destroy an existing channel of this type before re-registering
      if (this.channels.has(type)) {
        logger.info(`ChannelManager: Destroying existing ${type} channel before re-registering...`);
        try {
          await this.channels.get(type).destroy();
        } catch (err) {
          logger.warn(`ChannelManager: Error destroying previous ${type} channel: ${err.message}`);
        }
        this.channels.delete(type);
      }

      const channel = new ChannelClass(config, this.agent);

      // Route inbound messages through the agent
      channel.on('message', async (msg) => {
        const result = await this.agent.processInteraction(msg, {
          channel: type,
          channelId: channel.id
        });
        await channel.send(msg.userId, this.formatResponse(result));
      });

      // Bubble up special events
      channel.on('qr', (qr) => this.emit('qr', { channel: type, qr }));
      channel.on('command', (cmd) => this.emit('command', { channel: type, ...cmd }));
      channel.on('status', (status) => this.emit('status', { channel: type, status }));

      await channel.initialize();
      this.channels.set(type, channel);
      this.emit('channelRegistered', type);
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        logger.error(`Failed to load ${type} channel: Missing dependency — ${error.message}`);
      } else {
        logger.error(`Failed to initialize ${type} channel: ${error.message}`);
      }
      this.emit('channelError', { type, error });
    }
  }

  formatResponse(result) {
    if (!result.success) {
      return {
        text: `❌ ${result.error}`,
        suggestions: result.help ? [result.help] : undefined
      };
    }
    return {
      text: result.result && result.result.text ? result.result.text : JSON.stringify(result.result),
      buttons: result.result && result.result.buttons,
      metadata: result.metadata
    };
  }

  async send(channelType, userId, message) {
    const channel = this.channels.get(channelType);
    if (!channel) throw new Error(`Channel not registered: ${channelType}`);
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

  getRegisteredTypes() {
    return BaseChannel.getRegisteredTypes();
  }

  async closeAll() {
    for (const [type, channel] of this.channels) {
      try {
        await channel.destroy();
      } catch (error) {
        logger.error(`Error closing channel ${type}:`, error);
      }
    }
    this.channels.clear();
  }
}

// Static field assigned after class definition (Babel class-properties plugin not required)
ChannelManager.adapters = new Map();

export default ChannelManager;
