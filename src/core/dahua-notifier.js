'use strict';
/**
 * Pushes Dahua motion/IVS alarm events out through the ChannelManager (Telegram +
 * WhatsApp broadcast) in real time, via Dahua's eventManager.cgi multipart push stream.
 *
 * Historical log.cgi polling was tried first and abandoned: verified against a live
 * DH-XVR1B04-I that VideoMotion/IVS events are NOT retained in the historical alarm
 * log at all (30 days of Alarm-category history had zero motion entries even with
 * motion actively firing) — only eventManager.cgi's live push stream carries them.
 * See DahuaSkill.streamEvents().
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { STATE_PATH } = require('./config');

const DEFAULT_CODES = ['VideoMotion', 'CrossLineDetection', 'CrossRegionDetection', 'AlarmLocal', 'SmartMotionHuman', 'SmartMotionVehicle'];
const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const COOLDOWN_MS = 60000; // per (device, code, channel) — the stream fires Start *and* Stop per motion cycle

// Dahua's own historical log does NOT retain motion/IVS events (confirmed against a live
// device — see streamEvents() in the skill), so this is the only record of "what happened
// and when" for motion — every event this notifier sees gets appended here, independent of
// the Telegram/WhatsApp cooldown, so dahua.events.search can answer "did anything happen
// last night" even for events that got debounced out of a chat notification.
const EVENTS_LOG_PATH = path.join(STATE_PATH, 'dahua-events.jsonl');
const EVENTS_LOG_MAX_BYTES = 5 * 1024 * 1024 // rotate at 5MB so this can't grow unbounded

class DahuaNotifier {
  constructor(config, channelManager) {
    this.workspace = config.adapters?.cctv || {};
    this.channelManager = channelManager;
    this.codes = this.workspace.notify?.codes || DEFAULT_CODES;
    this.streams = new Map(); // deviceId -> { stop }
    this.reconnectTimers = new Map(); // deviceId -> timeout handle
    this.reconnectDelays = new Map(); // deviceId -> ms
    this.lastAlert = new Map(); // "device|code|channel" -> timestamp
    this.mutedUntil = new Map(); // "device|channel" -> timestamp (mutes ALL codes on that channel)
    this.stopped = false;
    this.enabled = true;
    this.skill = null;
  }

  start() {
    const deviceIds = Object.keys(this.workspace.dahua_devices || {});
    if (!deviceIds.length) return;
    if (this.workspace.notify?.enabled === false) { this.enabled = false; return; }

    const DahuaSkill = require('../skills/dahua/index.js');
    this.skill = new DahuaSkill({}, logger, this.workspace);

    for (const deviceId of deviceIds) this._connect(deviceId);
    logger.info(`DahuaNotifier: streaming real-time events for ${deviceIds.length} device(s)`);
  }

  /** Suppresses alerts (not persistence — search still sees everything) for a channel for durationMs. */
  muteChannel(deviceId, channel, durationMs) {
    this.mutedUntil.set(`${deviceId}|${channel}`, Date.now() + durationMs);
  }

  /** Stop streaming and mark disabled — same cleanup as stop(), but resumable via enable(). */
  disable() {
    this.stop();
    this.stopped = false; // stop() latches this permanently; undo so enable() can reconnect
    this.enabled = false;
  }

  /** Re-open event streams for every configured device after disable(). */
  enable() {
    if (this.enabled) return;
    this.enabled = true;
    const deviceIds = Object.keys(this.workspace.dahua_devices || {});
    if (!this.skill) {
      const DahuaSkill = require('../skills/dahua/index.js');
      this.skill = new DahuaSkill({}, logger, this.workspace);
    }
    for (const deviceId of deviceIds) this._connect(deviceId);
    logger.info(`DahuaNotifier: re-enabled, streaming ${deviceIds.length} device(s)`);
  }

  async _connect(deviceId) {
    if (this.stopped) return;
    try {
      const controller = await this.skill.streamEvents(deviceId, {
        codes: this.codes,
        onEvent: (ev) => {
          this._persistEvent(deviceId, ev);
          this._notify(deviceId, ev).catch(e => logger.warn(`DahuaNotifier: notify failed: ${e.message}`));
        },
        onClose: (err) => {
          if (err) logger.warn(`DahuaNotifier: stream for ${deviceId} closed: ${err.message}`);
          else logger.debug(`DahuaNotifier: stream for ${deviceId} closed cleanly — reconnecting`);
          this.streams.delete(deviceId);
          this._scheduleReconnect(deviceId);
        }
      });
      this.streams.set(deviceId, controller);
      this.reconnectDelays.set(deviceId, RECONNECT_BASE_MS); // reset backoff once connected
    } catch (e) {
      logger.warn(`DahuaNotifier: failed to open event stream for ${deviceId}: ${e.message}`);
      this._scheduleReconnect(deviceId);
    }
  }

  /** Appends every raw event (Start and Stop, not just what passes the notify cooldown) so search has full history. */
  _persistEvent(deviceId, ev) {
    try {
      if (fs.existsSync(EVENTS_LOG_PATH) && fs.statSync(EVENTS_LOG_PATH).size > EVENTS_LOG_MAX_BYTES) {
        fs.renameSync(EVENTS_LOG_PATH, `${EVENTS_LOG_PATH}.1`); // simple single-generation rotation
      }
      const line = `${JSON.stringify({ ts: new Date().toISOString(), device: deviceId, code: ev.code, action: ev.action, channel: ev.channel })}\n`;
      fs.appendFileSync(EVENTS_LOG_PATH, line);
    } catch (e) {
      logger.warn(`DahuaNotifier: failed to persist event: ${e.message}`);
    }
  }

  _scheduleReconnect(deviceId) {
    if (this.stopped) return;
    const delay = this.reconnectDelays.get(deviceId) || RECONNECT_BASE_MS;
    const timer = setTimeout(() => this._connect(deviceId), delay);
    this.reconnectTimers.set(deviceId, timer);
    this.reconnectDelays.set(deviceId, Math.min(delay * 2, RECONNECT_MAX_MS));
  }

  async _notify(deviceId, ev) {
    // Only fire on Start events (Dahua sends Start then Stop per motion cycle)
    if (ev.action && ev.action !== 'Start') return;

    const mutedUntil = this.mutedUntil.get(`${deviceId}|${ev.channel}`) || 0;
    if (Date.now() < mutedUntil) return;

    const key = `${deviceId}|${ev.code}|${ev.channel}`;
    const now = Date.now();
    const last = this.lastAlert.get(key) || 0;
    if (now - last < COOLDOWN_MS) return;
    this.lastAlert.set(key, now);

    const dev = this.workspace.dahua_devices[deviceId] || {};
    const label = dev.name || deviceId;
    const ch = ev.channel || 1;
    const ts = new Date().toLocaleString();
    const rtspAuth = `${encodeURIComponent(dev.user)}:${encodeURIComponent(dev.password)}`;
    const streamUrl = `rtsp://${rtspAuth}@${dev.host}:${dev.rtspPort || 554}/cgi-bin/realmonitor?channel=${ch}&subtype=0`;

    const caption = [
      `🚨 *Security Alert — ${label}*`,
      `⚡ *${ev.code}*${ev.channel ? ` · Ch ${ch}` : ''}`,
      `🕐 ${ts}`,
      `📡 Stream: \`${streamUrl}\``
    ].join('\n');

    logger.info(`DahuaNotifier: [${label}] ${ev.code} ch${ch}`);
    if (!this.channelManager) { logger.warn('DahuaNotifier: no channelManager, skipping notify'); return; }

    const channelCount = this.channelManager.channels.size;
    logger.debug(`DahuaNotifier: channelManager has ${channelCount} channel(s)`);

    // Try to grab a snapshot and send as photo; fall back to text-only
    let imgBuffer = null;
    try {
      const snap = await this.skill.execute('dahua.snapshot.get', { device: deviceId, channel: ch });
      if (snap?.base64) {
        imgBuffer = Buffer.from(snap.base64, 'base64');
        logger.info(`DahuaNotifier: snapshot captured for ${deviceId} ch${ch} (${imgBuffer.length} bytes)`);
      }
    } catch (e) {
      logger.warn(`DahuaNotifier: snapshot failed for ${deviceId}: ${e.message}`);
    }

    for (const [type, channel] of this.channelManager.channels) {
      if (type !== 'telegram' && type !== 'whatsapp') continue;
      try {
        if (imgBuffer) {
          if (type === 'telegram' && channel.bot) {
            const chats = channel.config?.allowed_ids || channel.config?.allowedChats || [];
            logger.info(`DahuaNotifier: sending photo to ${chats.length} Telegram chat(s)`);
            const d = deviceId; const c = ch;
            const reply_markup = {
              inline_keyboard: [
                [{ text: '📸 New Snapshot', callback_data: `dahua:snap:${d}:${c}` },  { text: '📡 Stream URL', callback_data: `dahua:stream:${d}:${c}` }],
                [{ text: '🎞 All Channels', callback_data: `dahua:snapall:${d}` },      { text: '🔇 Mute 1h', callback_data: `dahua:mute:${d}:${c}` }],
                [{ text: 'ℹ️ Camera Info', callback_data: `dahua:info:${d}` },          { text: '🔄 Reboot Cam', callback_data: `dahua:reboot:${d}` }],
                [{ text: '📋 Event Log', callback_data: `dahua:events:${d}` },          { text: '🤖 Ask Agent', callback_data: `dahua:ask:${d}:${c}` }],
                [{ text: '🏠 Main Menu', callback_data: 'process:start' },              { text: '✅ Dismiss', callback_data: 'dahua:dismiss' }]
              ]
            };
            for (const chatId of chats) {
              await channel.bot.sendPhoto(chatId, imgBuffer, { caption, parse_mode: 'Markdown', reply_markup }).catch((err) => {
                logger.warn(`DahuaNotifier: sendPhoto failed for chat ${chatId}: ${err.message}, falling back to text`);
                return channel.bot.sendMessage(chatId, caption, { parse_mode: 'Markdown', reply_markup });
              });
            }
          } else if (type === 'whatsapp' && channel.sock && channel.connected) {
            const { getChatRegistry } = require('./chat-registry');
            const jids = getChatRegistry().getChats('whatsapp');
            for (const jid of jids) {
              await channel.sock.sendMessage(jid, { image: imgBuffer, caption }).catch(e2 =>
                logger.warn(`WA send failed ${jid}: ${e2.message}`)
              );
            }
          }
        } else {
          await channel.broadcast(caption);
        }
      } catch (e) {
        logger.warn(`DahuaNotifier: send failed on ${type}: ${e.message}`);
      }
    }
  }

  stop() {
    this.stopped = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const controller of this.streams.values()) controller.stop();
    this.streams.clear();
  }
}

module.exports = { DahuaNotifier };
