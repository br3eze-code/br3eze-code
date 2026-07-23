'use strict';
/**
 * src/channels/index.js
 *
 * Public barrel for channel adapters.
 * Does NOT import Telegraf, Markup, WebSocketServer, etc. at module level.
 * Each concrete channel lazily requires its own peer deps inside its constructor.
 */

// Re-export the canonical channel system
const { BaseChannel } = require('../core/channels/BaseChannel');
const ChannelManager  = require('../core/channels/ChannelManager');

// Force-load built-in channel adapters (self-register via BaseChannel.register)
const CLIChannel       = require('../core/channels/CLIChannel');
const TelegramChannel  = require('../core/channels/TelegramChannel');
const WhatsappChannel  = require('../core/channels/WhatsappChannel');
const DiscordChannel   = require('../core/channels/DiscordChannel');
const SlackChannel     = require('../core/channels/SlackChannel');
const EmailChannel     = require('../core/channels/EmailChannel');
const SMSChannel       = require('../core/channels/SMSChannel');
const WebSocketChannel = require('../core/channels/WebSocketChannel');

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