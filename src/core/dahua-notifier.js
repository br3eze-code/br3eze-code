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

const { logger } = require('./logger');

const DEFAULT_CODES = ['VideoMotion', 'CrossLineDetection', 'CrossRegionDetection', 'AlarmLocal', 'SmartMotionHuman', 'SmartMotionVehicle'];
const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const COOLDOWN_MS = 60000; // per (device, code, channel) — the stream fires Start *and* Stop per motion cycle

class DahuaNotifier {
  constructor(config, channelManager) {
    this.workspace = config.adapters?.cctv || {};
    this.channelManager = channelManager;
    this.codes = this.workspace.notify?.codes || DEFAULT_CODES;
    this.streams = new Map(); // deviceId -> { stop }
    this.reconnectTimers = new Map(); // deviceId -> timeout handle
    this.reconnectDelays = new Map(); // deviceId -> ms
    this.lastAlert = new Map(); // "device|code|channel" -> timestamp
    this.stopped = false;
    this.skill = null;
  }

  start() {
    const deviceIds = Object.keys(this.workspace.dahua_devices || {});
    if (!deviceIds.length) return;
    if (this.workspace.notify?.enabled === false) return;

    const DahuaSkill = require('../skills/dahua/index.js');
    this.skill = new DahuaSkill({}, logger, this.workspace);

    for (const deviceId of deviceIds) this._connect(deviceId);
    logger.info(`DahuaNotifier: streaming real-time events for ${deviceIds.length} device(s)`);
  }

  async _connect(deviceId) {
    if (this.stopped) return;
    try {
      const controller = await this.skill.streamEvents(deviceId, {
        codes: this.codes,
        onEvent: (ev) => {
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

  _scheduleReconnect(deviceId) {
    if (this.stopped) return;
    const delay = this.reconnectDelays.get(deviceId) || RECONNECT_BASE_MS;
    const timer = setTimeout(() => this._connect(deviceId), delay);
    this.reconnectTimers.set(deviceId, timer);
    this.reconnectDelays.set(deviceId, Math.min(delay * 2, RECONNECT_MAX_MS));
  }

  async _notify(deviceId, ev) {
    const key = `${deviceId}|${ev.code}|${ev.channel}`;
    const now = Date.now();
    const last = this.lastAlert.get(key) || 0;
    if (now - last < COOLDOWN_MS) return; // debounce Start/Stop chatter on the same channel+code
    this.lastAlert.set(key, now);

    const dev = this.workspace.dahua_devices[deviceId] || {};
    const label = dev.name || deviceId;
    const message = `📹 *${label}*: ${ev.code}${ev.channel ? ` (channel ${ev.channel})` : ''}`;
    logger.info(`DahuaNotifier: ${message}`);
    if (!this.channelManager) return;
    await this.channelManager.broadcast(message, (type) => type === 'telegram' || type === 'whatsapp');
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
