import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';
import { logger } from '../logger.js';
import { BaseChannel } from './BaseChannel.js';
import { getTaskRegistry } from '../taskRegistry.js';
import { evaluateProactiveNotification } from '../proactive-policy.js';
import { buildProposalManifest } from '../channel-action-manifest.js';
import ProactiveTelemetry from '../proactive-telemetry.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


class ChannelManager extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.channels = new Map();
    this.proactiveTelemetry = agent?.services?.proactiveTelemetry || new ProactiveTelemetry();
    this._proposalEventHandlers = [];
    this._loadAdapters();
    this._wireProposalNotifications();
  }

  _wireProposalNotifications() {
    const registry = getTaskRegistry();
    const onProposal = (task) => {
      void this._notifyProposal(task).catch((error) => {
        logger.warn(`ChannelManager: proposal notification failed: ${error.message}`);
      });
    };
    registry.on('task:created', onProposal);
    registry.on('task:wbs-updated', onProposal);
    this._proposalEventHandlers = [
      ['task:created', onProposal],
      ['task:wbs-updated', onProposal],
    ];
  }

  async _notifyProposal(task) {
    const proposal = task?.nextActionProposal;
    const context = task?.planningContext || task?.scope || {};
    const channelType = task?.scope?.channel || context.channel;
    const userId = task?.scope?.userId || context.userId;
    if (!proposal?.valid || !channelType || !userId) return { allowed: false, reason: 'missing_delivery_scope' };
    const history = this.proactiveTelemetry.list({ userId, taskId: task.taskId, limit: 100 });
    const policy = evaluateProactiveNotification({ proposal, context, history });
    if (!policy.allowed || !policy.speakNow) return policy;
    const channel = this.channels.get(channelType);
    if (!channel) return { allowed: false, reason: 'channel_unavailable' };
    const top = proposal.candidates?.[0];
    const event = this.proactiveTelemetry.record({
      type: 'proposal_created',
      proposalId: proposal.proposalId,
      taskId: task.taskId,
      userId,
      channel: channelType,
      actionId: top?.actionId || null,
      confidence: top?.confidence,
      risk: top?.risk,
      safe: top?.risk !== 'high',
    });
    await channel.send(userId, {
      text: top?.label || 'A safe next step is ready.',
      buttons: buildProposalManifest(proposal),
      metadata: { type: 'next-action-proposal', proposalId: proposal.proposalId, taskId: task.taskId, eventId: event.eventId },
    });
    return { allowed: true, event };
  }

  /**
   * Forces loading of all channel adapter files in the current directory
   * to ensure they execute their self-registration calls on BaseChannel.
   */
  _loadAdapters() {
    try {
      const files = fs.readdirSync(__dirname);
      for (const file of files) {
        if (
          file.endsWith('Channel.js') &&
          file !== 'BaseChannel.js' &&
          file !== 'ChannelManager.js'
        ) {
          try {
            require(path.join(__dirname, file));
            logger.debug(`ChannelManager: Loaded channel adapter ${file}`);
          } catch (err) {
            logger.error(`ChannelManager: Failed to load adapter ${file}:`, err.message);
          }
        }
      }
    } catch (err) {
      logger.error('ChannelManager: Error reading channel adapters directory:', err.message);
    }
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

      // Opt-IN only: WHATSAPP_ENABLED must be explicitly 'true'.
      // The old opt-out default ('!== false') caused a second Baileys socket to
      // start alongside any already-running WhatsApp session, making WhatsApp
      // force-close the competing socket's Signal Protocol sessions in a loop.
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

    for (const chan of channelConfigs) {
      logger.info(`ChannelManager: Registering ${chan.type} channel...`);
      await this.register(chan);
    }
  }

  static registerAdapter(type, adapterClass) {
    BaseChannel.register(type, adapterClass);
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
    const registry = getTaskRegistry();
    for (const [eventName, handler] of this._proposalEventHandlers) registry.off(eventName, handler);
    this._proposalEventHandlers = [];
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
