import { BaseChannel } from './BaseChannel.js';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// src/core/channels/USSDChannel.js

class USSDChannel extends BaseChannel {
    static getMetadata() {
        return {
            name: 'USSD',
            description: 'Offline reach via GSM gateways',
            configFields: [
        {
                "name": "port",
                "type": "input",
                "message": "Modem Port:",
                "default": "/dev/ttyUSB0"
        }
]
        };
    }

  constructor(config, agent) {
    super(config, agent);
    this.provider = config.provider || 'africastalking';
    // Manage USSD sessions
    this.sessions = new Map();
    this._registerHandlers();
  }

  async initialize() {
    this.connected = true;
    console.log(`USSDChannel initialized using provider: ${this.provider}`);
  }

  _rl(fn, requiredRole = null) {
    return async (phoneNumber, msg, args, sessionId) => {
      try {
        const { getDatabase } = require('../database');
        const db = await getDatabase();

        await db.upsertUser(phoneNumber, {
          username: phoneNumber,
          platform: 'ussd',
          channels: { ussd: phoneNumber }
        }).catch(e => console.warn(`USSD user sync failed: ${e.message}`));

        // Resolve (or auto-provision) the caller's Firebase Auth record.
        // 1. Sync identity (Register JID in local DB if new)
        await db.upsertUser(phoneNumber, {
          channel: 'ussd',
          channelId: phoneNumber,
          lastActive: new Date().toISOString()
        });

        // 2. Bridge to Firebase (Resolve canonical UID)
        const authUser = await db.resolveFirebaseUser(phoneNumber, {
          channel: 'ussd',
          channelId: phoneNumber
        }).catch(() => null);

        // 3. Fallback & Attach (Inject userDoc + _uid into ctx)
        const _uid = authUser?.uid || phoneNumber;
        const userDoc = db.getUserDoc(_uid);
        const ctx = { phoneNumber, sessionId, userDoc, _uid, db };

        // 4. Admin-tier commands require role:'admin' (Firestore) or legacy
        // allowed_ids membership. Guest commands (start, menu, link, claim)
        // pass no requiredRole and stay open even after allowed_ids is set —
        // otherwise no one but the claiming admin could ever link an account.
        if (requiredRole && !this.isAuthorized(phoneNumber, _uid)) {
          const role = userDoc?.role || 'user';
          if (role !== requiredRole && !(requiredRole === 'admin' && role === 'reseller')) {
            return this.send(phoneNumber, `END Access denied — this command requires ${requiredRole} access.`, { sessionId });
          }
        }

        await fn.call(this, phoneNumber, msg, args, sessionId, ctx);
      } catch (err) {
        console.error(`USSDChannel handler error: ${err.message}`, { phoneNumber });
        await this.send(phoneNumber, `END Error: ${err.message}`, { sessionId }).catch(() => { });
      }
    };
  }

  _registerHandlers() {
    this.handlers = new Map();
    const H = require('./HandlerLibrary');

    this.handlers.set('start', this._handleStart.bind(this));
    this.handlers.set('menu', this._handleMenu.bind(this));
    this.handlers.set('dashboard', (j) => H.handleDashboard(this, j));
    this.handlers.set('stats', (j) => H.handleStats(this, j));
    this.handlers.set('network', (j) => H.handleNetwork(this, j));
    this.handlers.set('users', (j) => H.handleUsers(this, j));
    this.handlers.set('ping', (j) => H.handlePing(this, j));
    this.handlers.set('link', this._handleLink.bind(this));
    this.handlers.set('claim', this._handleClaim.bind(this));

    // Mirrors Telegram/WhatsApp's admin tier — stats/network/users require
    // role:'admin' or legacy allowed_ids membership; start/menu/link/claim
    // stay guest-open (see _rl()).
    this.adminCommands = new Set(['stats', 'network', 'users']);
  }

  async _handleStart(phoneNumber, msg, args, sessionId) {
    await this.send(phoneNumber, 'CON Welcome to AgentOS USSD.\n1. Dashboard\n2. Stats\n3. Network\n4. Exit', { sessionId });
  }

  async _handleMenu(phoneNumber, msg, args, sessionId) {
    await this.send(phoneNumber, 'CON AgentOS Menu:\n1. Dashboard\n2. Stats\n3. Network\n4. Exit', { sessionId });
  }

  async _handleLink(phoneNumber, msg, args, sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) session.pendingAction = 'link';
    await this.send(phoneNumber,
      'CON Enter the 6-digit code from the Power Connect app (Settings -> Link Chat Account), or the phone number you verified there (with country code):',
      { sessionId });
  }

  async _handleClaim(phoneNumber, msg, args, sessionId) {
    if (this.config.allowed_ids && this.config.allowed_ids.length > 0) {
      return this.send(phoneNumber, 'END Admin already claimed.', { sessionId });
    }
    const session = this.sessions.get(sessionId);
    if (session) session.pendingAction = 'claim';
    await this.send(phoneNumber,
      'CON To claim admin, enter the 6-digit code from the Power Connect app (Settings -> Link Chat Account):',
      { sessionId });
  }

  // Consumes the code (or, for /link only, a phone/email) a prior /link or
  // /claim prompt is waiting on. Reuses the same transactional verifier
  // Telegram/WhatsApp use, so a linkCodes doc generated in the app works
  // identically across every channel. /claim stays code-only — it grants
  // admin, so it must not accept a bare phone/email match.
  async _consumeLinkCode(phoneNumber, input, action, sessionId) {
    input = String(input).trim();

    if (action === 'link' && !/^\d{6}$/.test(input)) {
      // Phone/email path — same Firebase Auth lookup Telegram/WhatsApp use.
      // Firebase Phone Auth records verified on the website resolve here by
      // number, so a caller can link an account they verified elsewhere.
      const { getDatabase } = require('../database');
      const db = await getDatabase();
      const result = await db.resolveFirebaseUser(input, { channel: 'ussd', channelId: phoneNumber });
      if (result) {
        return this.send(phoneNumber, `END Account linked. Welcome, ${result.fullname || 'User'}.`, { sessionId });
      }
      return this.send(phoneNumber, "END User not found. Try your email, verified phone number (with country code), or the 6-digit code from the website.", { sessionId });
    }

    const { verifyLinkCode } = await import('./link-verifier.js');
    const result = await verifyLinkCode(input, 'ussd', phoneNumber);
    const plain = result.message.replace(/[*_`]/g, '');

    if (!result.ok) {
      return this.send(phoneNumber, `END ${plain}`, { sessionId });
    }
    if (action === 'claim') {
      this.config.allowed_ids = [phoneNumber];
      return this.send(phoneNumber, 'END Account linked and admin claimed. USSD admin commands are now restricted to this number.', { sessionId });
    }
    return this.send(phoneNumber, `END ${plain}`, { sessionId });
  }

  async handleIncomingUSSD(sessionId, phoneNumber, text, rawData = {}) {
    const { getChatRegistry } = require('../chat-registry');
    getChatRegistry().register('ussd', phoneNumber);

    // Track session state
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { id: sessionId, phoneNumber, history: [] };
      this.sessions.set(sessionId, session);
    }
    session.history.push(text);

    // A prior /link or /claim prompt is waiting on a 6-digit code — this
    // input IS that code, not a new command.
    if (session.pendingAction) {
      const action = session.pendingAction;
      session.pendingAction = null;
      const wrapped = this._rl((phoneNum, code, args, sessId) => this._consumeLinkCode(phoneNum, code, action, sessId));
      await wrapped(phoneNumber, text, [], sessionId);
      return;
    }

    // Basic USSD routing
    if (text === '') {
      const wrapped = this._rl(this.handlers.get('start'));
      await wrapped(phoneNumber, text, [], sessionId);
      return;
    }

    const cmdName = text.trim().toLowerCase().split(/\s+/)[0];
    const handler = this.handlers?.get(cmdName);

    if (handler) {
      const args = text.trim().split(/\s+/).slice(1);
      const wrapped = this._rl(handler, this.adminCommands?.has(cmdName) ? 'admin' : null);
      await wrapped(phoneNumber, text, args, sessionId);
      return;
    }

    const wrappedNL = this._rl(async (phoneNum, msgText, args, sessId, ctx) => {
      this.emit('message', {
        userId: phoneNum,
        sessionId: sessId,
        channel: 'ussd',
        channelId: phoneNum,
        text: msgText,
        raw: rawData,
        userDoc: ctx?.userDoc,
        _uid: ctx?._uid
      });
    });
    await wrappedNL(phoneNumber, text, [], sessionId);
  }

  // Override base send to support USSD CON/END semantics while maintaining compatibility
  async send(userId, message, options = {}) {
    let sessionId = options.sessionId;
    if (!sessionId) {
      for (const [sid, sess] of this.sessions.entries()) {
        if (sess.phoneNumber === userId) {
          sessionId = sid;
          break;
        }
      }
    }
    sessionId = sessionId || 'default_session';

    let text = message;
    if (typeof message === 'object') {
      text = message.text;
    }

    // Ensure USSD format (CON for continue, END for terminate)
    if (!text.startsWith('CON ') && !text.startsWith('END ')) {
      text = 'CON ' + text;
    }

    if (text.startsWith('END ')) {
      this.sessions.delete(sessionId);
    }

    console.log(`[USSD to ${userId} (Session: ${sessionId})]: ${text}`);
    this.messageCount++;
    return { success: true, text };
  }

  // Support typical BaseChannel send
  async sendBase(userId, message) {
    return this.send('default_session', userId, message);
  }

  async broadcast(message) {
    console.log(`[USSD Broadcast NOT SUPPORTED]: ${message}`);
    return Promise.allSettled([]);
  }

  getStatus() {
    return {
      ...super.getStatus(),
      provider: this.provider,
      activeSessions: this.sessions.size
    };
  }
}

BaseChannel.register('ussd', USSDChannel);

export default USSDChannel;
