/**
 * src/channels/index.js
 *
 * Public barrel for channel adapters.
 * Does NOT import Telegraf, Markup, WebSocketServer, etc. at module level.
 * Each concrete channel lazily requires its own peer deps inside its constructor.
 */

// Re-export the canonical channel system
import { BaseChannel } from '../core/channels/BaseChannel.js';
import ChannelManager from '../core/channels/ChannelManager.js';

// Force-load built-in channel adapters (self-register via BaseChannel.register)
import CLIChannel from '../core/channels/CLIChannel.js';
import TelegramChannel from '../core/channels/TelegramChannel.js';
import WhatsappChannel from '../core/channels/WhatsappChannel.js';
import DiscordChannel from '../core/channels/DiscordChannel.js';
import SlackChannel from '../core/channels/SlackChannel.js';
import EmailChannel from '../core/channels/EmailChannel.js';
import SMSChannel from '../core/channels/SMSChannel.js';
import WebSocketChannel from '../core/channels/WebSocketChannel.js';

module.exports = {
  BaseChannel,
  ChannelManager,
  CLIChannel,
  TelegramChannel,
  WhatsappChannel,
  DiscordChannel,
  SlackChannel,
  EmailChannel,
  SMSChannel,
  WebSocketChannel,
};
