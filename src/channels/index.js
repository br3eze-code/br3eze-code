import { BaseChannel } from './base.js';
import WhatsAppChannel from './whatsapp.js';
import TelegramChannel from './telegram.js';
import { DiscordChannel } from './discord.js';
import { SlackChannel } from './slack.js';
import SMSAdapter from './sms.adapter.js';
import WebAdapter from './web.adapter.js';
import { WebSocketChannel } from './websocket.js';

/**
 * Canonical channel adapter barrel.
 * Concrete transport/provider implementations stay outside the AgentOS kernel.
 */
export {
  BaseChannel,
  WhatsAppChannel,
  TelegramChannel,
  DiscordChannel,
  SlackChannel,
  SMSAdapter,
  WebAdapter,
  WebSocketChannel
};
