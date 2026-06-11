// NOTE: @whiskeysockets/baileys is ESM-only — must be loaded via dynamic import()
// inside initialize(), never at the top level via require().
const path = require("path");
const fs = require("fs");
const _chalk = require("chalk");
const chalk = _chalk.default || _chalk;
const { logger } = require("../logger");
const { BaseChannel } = require("./BaseChannel");

class WhatsAppChannel extends BaseChannel {
  static getMetadata() {
    return {
      name: "WhatsApp",
      description: "Native WhatsApp integration via Baileys",
      configFields: [
        {
          name: "authStateFolder",
          type: "input",
          message: "Auth State Folder:",
          default: "./data/whatsapp_auth",
        },
      ],
    };
  }

  async validateConfig() {
    const waAuthDir = this.config.authStateFolder || "./data/whatsapp_auth";
    if (!fs.existsSync(waAuthDir)) {
      return { valid: false, error: "Missing auth data folder" };
    }
    return { valid: true, error: null };
  }

  constructor(config, agent) {
    super(config, agent);
    this.sock = null;
    this.qrCode = null;
    this.authStateFolder =
      config.authStateFolder ||
      path.join(process.cwd(), "data", "whatsapp_auth");
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20; // Cap at 20 to prevent resource exhaustion
    this.allowedJids = new Set();
    const rawAllowed = config.allowed_ids || config.allowedJids || [];
    rawAllowed.forEach((id) => {
      const normalized = this.normalizeJid(id);
      if (normalized) this.allowedJids.add(normalized);
    });

    // Patterns from TelegramChannel
    this.rateLimiter = new Map();
    this.pendingInputs = new Map(); // jid -> { action, data }
    this.messageCache = new Map();
    this._alertState = new Map();

    // Command registry
    this.handlers = new Map();
    this._registerHandlers();
    this._handlersRegistered = true;
  }

  /**
   * Normalize JID format
   */
  normalizeJid(jid) {
    if (!jid) return null;
    const s = String(jid).trim();

    // 1. Handle JID with domain
    if (s.includes("@")) {
      const [id, domain] = s.split("@");

      // WhatsApp domains: s.whatsapp.net (user), g.us (group), lid (identity), c.us (alternate user)
      const waDomains = ["s.whatsapp.net", "g.us", "lid", "c.us"];
      if (waDomains.includes(domain)) {
        const finalDomain = domain === "c.us" ? "s.whatsapp.net" : domain;

        if (finalDomain === "s.whatsapp.net") {
          // Individuals: Strip multi-device suffix and non-digits
          const number = id.split(":")[0].replace(/[^0-9]/g, "");
          return `${number}@${finalDomain}`;
        }
        // Groups and LIDs: Keep alphanumeric structure but lowercase domain
        return `${id}@${finalDomain}`;
      }

      // Other @ identifiers (like emails): Lowercase for consistency
      return s.toLowerCase();
    }

    // 2. No @ domain: Check if it's a UID or a raw phone number
    // Firebase UIDs are alphanumeric (case-sensitive usually, but we keep as-is)
    if (/[a-zA-Z]/.test(s)) {
      return s;
    }

    // Pure digits: Assume phone number and normalize to JID
    const number = s.replace(/[^0-9]/g, "");
    if (!number) return s;
    return `${number}@s.whatsapp.net`;
  }

  /**
   * Check if JID is authorized
   */
  isAuthorized(jid, uid = null) {
    if (!jid) return false;
    const allowed = this.config.allowed_ids || [];
    if (allowed.length === 0) return true;

    const normalizedJid = this.normalizeJid(jid);
    const jidNumber = normalizedJid.split("@")[0];

    for (const entry of allowed) {
      const sEntry = String(entry).trim();
      if (!sEntry) continue;

      // 1. Direct match (JID, UID, or Email)
      if (sEntry === normalizedJid || sEntry === jid || (uid && sEntry === uid))
        return true;

      // 2. Prefix match for UID
      if (uid && sEntry === `uid:${uid}`) return true;

      // 3. Number-only match (if entry is just digits)
      if (/^\d+$/.test(sEntry) && sEntry === jidNumber) return true;

      // 4. Match against normalized version of the entry
      const normalizedEntry = this.normalizeJid(sEntry);
      if (normalizedEntry === normalizedJid) return true;
    }

    return false;
  }

  async initialize() {
    if (!this.config.enabled && this.config.enabled !== undefined) {
      logger.info("WhatsApp channel disabled");
      return;
    }

    // Ensure previous socket is cleaned up before a new initialization
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners("connection.update");
        this.sock.ev.removeAllListeners("creds.update");
        this.sock.ev.removeAllListeners("messages.upsert");
        this.sock.end(new Error("Re-initializing socket"));
      } catch (e) {
        // Ignore errors during cleanup
      }
      this.sock = null;
    }

    // 1. Verify AuthState Integrity
    const credsFile = path.join(this.authStateFolder, "creds.json");
    if (fs.existsSync(credsFile)) {
      try {
        JSON.parse(fs.readFileSync(credsFile, "utf8"));
      } catch (e) {
        logger.error("WhatsApp creds.json is corrupt. Resetting session.");
        fs.renameSync(credsFile, `${credsFile}.bak-${Date.now()}`);
      }
    }

    try {
      // Dynamic import required: @whiskeysockets/baileys is ESM-only
      const baileysModule = await import("@whiskeysockets/baileys");
      const makeWASocket = baileysModule.default;
      const {
        DisconnectReason,
        useMultiFileAuthState,
        fetchLatestBaileysVersion,
      } = baileysModule;

      const { state, saveCreds } = await useMultiFileAuthState(
        this.authStateFolder,
      );

      // 2. Fetch version with timeout fallback
      let version;
      let isLatest = false;
      try {
        const v = await fetchLatestBaileysVersion();
        version = v.version;
        isLatest = v.isLatest;
      } catch (e) {
        logger.warn(
          "Failed to fetch Baileys version, using fallback [2, 3000, 101594821]",
        );
        version = [2, 3000, 101594821];
      }

      logger.info(
        `Initializing WhatsApp with Baileys v${version.join(".")} (isLatest: ${isLatest})`,
      );

      // Adapter for Baileys (pino) logger to AgentOS (winston) logger
      const createBaileysLogger = (parent) => {
        const isDebug =
          process.env.LOG_LEVEL === "debug" ||
          process.env.DEBUG?.includes("whatsapp") ||
          process.env.WHATSAPP_DEBUG === "true";
        return {
          level: isDebug ? "debug" : "warn",
          child: (bindings) => createBaileysLogger(parent.child(bindings)),
          trace: (obj, msg) => {
            if (isDebug)
              typeof obj === "string"
                ? parent.debug(obj)
                : parent.debug(msg || "", obj);
          },
          debug: (obj, msg) => {
            if (isDebug)
              typeof obj === "string"
                ? parent.debug(obj)
                : parent.debug(msg || "", obj);
          },
          info: (obj, msg) => {
            if (isDebug)
              typeof obj === "string"
                ? parent.info(obj)
                : parent.info(msg || "", obj);
          },
          warn: (obj, msg) =>
            typeof obj === "string"
              ? parent.warn(obj)
              : parent.warn(msg || "", obj),
          error: (obj, msg) =>
            typeof obj === "string"
              ? parent.error(obj)
              : parent.error(msg || "", obj),
          fatal: (obj, msg) =>
            typeof obj === "string"
              ? parent.error(obj)
              : parent.error(msg || "", obj),
        };
      };

      this.sock = makeWASocket({
        version,
        auth: state,
        browser: ["AgentOS", "Desktop", "1.0"],
        logger: createBaileysLogger(
          logger.child({ service: "whatsapp-channel" }),
        ),
        shouldSyncHistoryMessage: () => false,
        markOnlineOnConnect: true,
        printQRInTerminal: false,
      });

      // Store disconnect reason reference for the event handler
      this._DisconnectReason = DisconnectReason;

      this.sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrCode = qr;
          this.emit("qr", qr);

          const qrcode = require("qrcode-terminal");

          if (global.startupSpinner && global.startupSpinner.isSpinning) {
            // Temporarily stop spinner to show QR cleanly
            global.startupSpinner.stop();
            console.log(`\n📱 ${chalk.cyan("WhatsApp Login Required")}`);
            console.log(
              chalk.gray("Scan the code below to connect your account:\n"),
            );
            qrcode.generate(qr, { small: true });
            console.log(""); // spacer
            global.startupSpinner.start();
          } else {
            logger.info("WhatsApp QR code generated");
            qrcode.generate(qr, { small: true });
          }
        }

        if (connection === "close") {
          const code = lastDisconnect?.error?.output?.statusCode;
          const DR = this._DisconnectReason || {};

          // Codes where reconnecting is futile
          const loggedOut = code === DR.loggedOut;         // 401 — needs re-pair
          const replaced = code === DR.connectionReplaced; // 440 — another session took over
          const multideviceFailed = code === DR.multideviceMismatch; // 411
          const forbidden = code === DR.forbidden;         // 403 — banned/blocked
          const badSession = code === DR.badSession;       // 500 — corrupted auth
          // 408 = timedOut, 428 = connectionClosed, 515 = restartRequired → all reconnectable

          const shouldReconnect = !loggedOut && !replaced && !multideviceFailed && !forbidden && !badSession;

          logger.info(
            `WhatsApp connection closed (code: ${code}). Reconnecting: ${shouldReconnect}`,
          );
          this.connected = false;
          this.qrCode = null;
          this.emit("status", "disconnected");

          if (replaced) {
            logger.warn(
              `WhatsApp session replaced by another device/process (code ${code}). Stop the other instance to reconnect.`,
            );
            this.emit("replaced");
          } else if (loggedOut) {
            logger.info("WhatsApp logged out. Please re-scan QR code.");
            this.emit("logout");
          } else if (forbidden) {
            logger.error("WhatsApp forbidden (403). Account may be banned.");
          } else if (badSession) {
            logger.error("WhatsApp bad session (500). Deleting auth state and stopping.");
            try {
              const credsFile = require('path').join(this.authStateFolder, 'creds.json');
              if (require('fs').existsSync(credsFile)) {
                require('fs').renameSync(credsFile, `${credsFile}.bak-${Date.now()}`);
              }
            } catch (_) { /* ignore */ }
          } else if (multideviceFailed) {
            logger.warn(
              `WhatsApp multidevice mismatch (code ${code}). Restart or re-pair the session.`,
            );
          } else if (
            shouldReconnect &&
            this.reconnectAttempts < this.maxReconnectAttempts
          ) {
            this.reconnectAttempts++;
            // Add jitter to avoid synchronization spikes (500ms - 1500ms)
            const jitter = Math.floor(Math.random() * 1000) + 500;
            const delay = Math.min(
              1000 * Math.pow(2, this.reconnectAttempts) + jitter,
              60000,
            );
            logger.info(
              `Scheduling WhatsApp reconnect (attempt ${this.reconnectAttempts}) in ${Math.round(delay / 1000)}s...`,
            );

            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => {
              logger.info(
                `WhatsApp reconnection attempt ${this.reconnectAttempts} starting...`,
              );
              this.initialize();
            }, delay);
          } else if (!shouldReconnect) {
            // already handled above (loggedOut, replaced, etc.)
          } else {
            logger.error(
              `WhatsApp max reconnect attempts (${this.maxReconnectAttempts}) reached. Manual intervention required. Restart AgentOS to resume.`,
            );
            this.emit("max_reconnects");
          }
        } else if (connection === "open") {
          this.connected = true;
          this.qrCode = null;
          this.reconnectAttempts = 0;
          // Signal to legacy WhatsAppService/src/channels/whatsapp.js that this
          // canonical channel is active, preventing a second competing Baileys socket.
          global._whatsappChannelActive = true;
          if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
          }
          this.emit("connected");
          this.emit("status", "connected");
          logger.info("WhatsApp connected successfully");
        }
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("messages.upsert", async (m) => {
        try {
          if (m.type !== "notify") return;

          for (const msg of m.messages) {
            // Ignore messages from self and those without a message body
            if (msg.key.fromMe || !msg.message) continue;

            // Deduplicate (Baileys sometimes sends same message twice)
            const msgId = msg.key.id;
            if (this.messageCache.has(msgId)) continue;
            this.messageCache.set(msgId, Date.now());

            await this.handleIncomingMessage(msg);
          }
        } catch (error) {
          logger.error("WhatsApp message upsert handling error:", error);
        }
      });

      // Periodic cache cleanup
      this.cacheCleanup = setInterval(() => {
        const now = Date.now();
        for (const [id, time] of this.messageCache.entries()) {
          if (now - time > 300000) this.messageCache.delete(id);
        }
      }, 60000);
    } catch (error) {
      this.errorCount++;
      logger.error("WhatsApp initialization error:", error);
      throw error;
    }
  }

  // ── Rate limiting & Middleware ─────────────────────────────────────────────

  _checkRateLimit(jid) {
    const now = Date.now();
    const key = jid.toString();
    const limit = 30;

    if (!this.rateLimiter.has(key)) {
      this.rateLimiter.set(key, { count: 1, resetTime: now + 60_000 });
      return { allowed: true, remaining: limit - 1, resetTime: now + 60_000 };
    }

    const slot = this.rateLimiter.get(key);
    if (now > slot.resetTime) {
      slot.count = 1;
      slot.resetTime = now + 60_000;
      return { allowed: true, remaining: limit - 1, resetTime: slot.resetTime };
    }

    if (slot.count >= limit) {
      return { allowed: false, remaining: 0, resetTime: slot.resetTime };
    }

    slot.count++;
    return {
      allowed: true,
      remaining: limit - slot.count,
      resetTime: slot.resetTime,
    };
  }

  /**
   * Rate Limit & Auth Wrapper (similar to Telegram's _rl)
   */
  _rl(fn) {
    return async (jid, msg, match) => {
      // 1. Identity Resolution & Bridging
      let authUser = null;
      let resolvedUid = null;

      try {
        const { getDatabase } = require("../database");
        const db = await getDatabase();

        const pushName = msg.pushName || "";
        const number = jid.split("@")[0];

        // Sync local user record
        await db
          .upsertUser(jid, {
            username: pushName || number,
            firstName: pushName,
            platform: "whatsapp",
            channels: { whatsapp: jid },
            phoneNumber: number,
          })
          .catch((e) => logger.warn(`WhatsApp user sync failed: ${e.message}`));

        // Bridge to Firebase Auth
        authUser = await db
          .resolveFirebaseUser(jid, {
            channel: "whatsapp",
            channelId: jid,
          })
          .catch(() => null);

        if (authUser?.uid) {
          resolvedUid = authUser.uid;
          msg.userDoc = db.getUserDoc(resolvedUid);
          msg._uid = resolvedUid;
          logger.debug(`[WhatsApp] Identity bridged: ${jid} -> ${resolvedUid}`);
        } else {
          // Fallback: use jid as the document ID
          msg.userDoc = db.getUserDoc(jid);
          msg._uid = jid;
        }
      } catch (dbErr) {
        logger.error(`WhatsApp database resolution failed: ${dbErr.message}`);
      }

      // 2. Authorization Check (includes platform JID and resolved UID)
      if (!this.isAuthorized(jid, resolvedUid)) {
        logger.warn(
          `Unauthorized WhatsApp access attempt from ${jid} (UID: ${resolvedUid || "none"})`,
        );
        return;
      }

      // 3. Rate Limiting
      const rlStatus = this._checkRateLimit(jid);
      if (!rlStatus.allowed) {
        const seconds = Math.ceil((rlStatus.resetTime - Date.now()) / 1000);
        return this.send(
          jid,
          `⏳ *Rate limit* — please slow down. Reset in ${seconds}s.`,
        );
      }

      // Inject metadata
      msg._rl = rlStatus;

      try {
        await fn.call(this, jid, msg, match);
      } catch (err) {
        logger.error(`WhatsAppChannel handler error: ${err.message}`, { jid });
        await this.send(jid, `❌ *Error:* ${err.message}`).catch(() => { });
      }
    };
  }

  _registerHandlers() {
    this.handlers.set("start", this._handleStart);
    this.handlers.set("menu", this._handleMenu);
    this.handlers.set("help", this._handleHelp);
    this.handlers.set("dashboard", this._handleDashboard);
    this.handlers.set("voucher", this._handleVoucher);
    this.handlers.set("users", this._handleUsers);
    this.handlers.set("stats", this._handleStats);
    this.handlers.set("kick", this._handleKick);
    this.handlers.set("reboot", this._handleReboot);
    this.handlers.set("dahua", this._handleDahua);
    this.handlers.set("ping", this._handlePing);
    this.handlers.set("ask", this._handleAsk);
    this.handlers.set("cli", this._handleCli);
    this.handlers.set("api", this._handleApi);
    this.handlers.set("wallet", this._handleWallet);
    this.handlers.set("pay", this._handlePay);
    this.handlers.set("claim", this._handleClaim);
    this.handlers.set("token", this._handleToken);
    this.handlers.set("tools", this._handleTools);
    this.handlers.set("tool", this._handleTool);
    this.handlers.set("setup_router", this._handleSetupRouter);
    this.handlers.set("network", this._handleNetwork);
    this.handlers.set("neighbors", this._handleNeighbors);
    this.handlers.set("dns", this._handleDns);
    this.handlers.set("status", this._handleStatus);
    this.handlers.set("bulk", this._handleBulkVoucher);
    this.handlers.set("mistakes", this._handleMistakes);
    this.handlers.set("transfer", this._handleTransfer);
  }

  // ── Missing handlers (registered above) ──────────────────────────────────────

  async _handleNeighbors(jid) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");
    try {
      const neighbors = (await mt.executeTool("neighbors.list", {})) || [];
      let msg = `🔍 *ARP / Neighbor Table*\n\n`;
      if (!neighbors.length) {
        msg += "_No neighbors found_";
      } else {
        neighbors.slice(0, 20).forEach((n) => {
          msg += `📡 *${n.identity || n["mac-address"] || "Unknown"}*\n`;
          msg += `   IP: ${n.address || n["ip-address"] || "N/A"} | MAC: ${n["mac-address"] || "N/A"}\n`;
          if (n.interface) msg += `   Interface: ${n.interface}\n`;
        });
        if (neighbors.length > 20)
          msg += `\n_...and ${neighbors.length - 20} more_`;
      }
      await this.send(jid, msg);
    } catch (err) {
      await this.send(jid, `❌ Neighbors error: ${err.message}`);
    }
  }

  async _handleDns(jid, msg, args) {
    const host = args?.[1];
    if (!host) {
      this.pendingInputs.set(jid, { action: "dns" });
      return this.send(
        jid,
        "🌐 *DNS Lookup*\nPlease enter the hostname to resolve:",
      );
    }
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");
    try {
      const result = await mt.executeTool("dns.resolve", { name: host });
      await this.send(
        jid,
        `🌐 *DNS: ${host}*\n\nIP: \`${result?.address || result || "N/A"}\``,
      );
    } catch (err) {
      await this.send(jid, `❌ DNS error: ${err.message}`);
    }
  }

  async _handleBulkVoucher(jid, msg, args) {
    const planId = args?.[1];
    const count = parseInt(args?.[2]) || 1;

    if (!planId) {
      return this.send(
        jid,
        "❌ Usage: */bulk <planId> <count>*\nExample: `/bulk 1Day 5`",
      );
    }
    if (count < 1 || count > 20) {
      return this.send(jid, "❌ Count must be between 1 and 20.");
    }

    const { getDatabase } = require("../database");
    const db = await getDatabase();
    const uid = msg._uid || jid;
    const user = await db.getUser(uid);
    const isAdmin = user?.role === "admin" || user?.role === "reseller";

    if (!isAdmin) {
      return this.send(
        jid,
        "❌ *Access Denied:* Bulk voucher generation requires admin or reseller role.",
      );
    }

    await this.send(
      jid,
      `🎫 Generating *${count}* voucher(s) for plan *${planId}*...`,
    );

    const codes = [];
    const errors = [];
    for (let i = 0; i < count; i++) {
      try {
        await this._createVoucher(jid, planId, uid);
        codes.push(i + 1);
      } catch (err) {
        errors.push(`#${i + 1}: ${err.message}`);
      }
    }

    let reply = `✅ *Bulk Vouchers Created: ${codes.length}/${count}*\n`;
    if (errors.length) reply += `\n⚠️ Errors:\n${errors.join("\n")}`;
    await this.send(jid, reply);
  }

  async handleIncomingMessage(message) {
    this.messageCount++;
    const from = message.key.remoteJid;

    // Extract text from various message types
    const text =
      message.message?.conversation ||
      message.message?.extendedTextMessage?.text ||
      message.message?.imageMessage?.caption ||
      message.message?.videoMessage?.caption ||
      message.message?.buttonsResponseMessage?.selectedButtonId ||
      message.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
      "";

    // Register active chat for broadcasts
    const { getChatRegistry } = require("../chat-registry");
    getChatRegistry().register("whatsapp", from);

    // Command Dispatcher
    if (text.startsWith("/")) {
      const args = text.slice(1).trim().split(/\s+/);
      const cmdName = args[0].toLowerCase();
      const handler = this.handlers.get(cmdName);

      if (handler) {
        const wrapped = this._rl(handler);
        await wrapped(from, message, args);
        return;
      }
    }

    // Pending Inputs (Prompts)
    const pending = this.pendingInputs.get(from);
    if (pending && text.trim()) {
      this.pendingInputs.delete(from);
      const wrapped = this._rl(this._executePending);
      await wrapped(from, message, {
        text: text.trim(),
        action: pending.action,
        data: pending.data,
      });
      return;
    }

    // Natural Language / Default Emit
    if (text.trim()) {
      // ── Email Identity Capture ──────────────────────────────────────────
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi;
      const emails = text.match(emailRegex);
      if (emails && emails.length > 0) {
        const email = emails[0].toLowerCase();
        const { getDatabase } = require("../database");
        const db = await getDatabase();

        await db
          .upsertUser(from, {
            email,
            platform: "whatsapp",
            lastSeen: new Date().toISOString(),
          })
          .catch((e) =>
            logger.warn(`[WhatsApp] Email capture sync failed: ${e.message}`),
          );

        logger.info(`[WhatsApp] Captured email ${email} from ${from}`);
      }

      const wrappedNL = this._rl(async (jid, rawMsg) => {
        this.emit("message", {
          text: text.trim(),
          userId: rawMsg._uid || jid,
          platformId: jid,
          sender: rawMsg.pushName || jid.split("@")[0],
          channel: "whatsapp",
          raw: rawMsg,
          userDoc: rawMsg.userDoc,
        });
      });
      await wrappedNL(from, message);
    }
  }

  /**
   * Set a pending input for a user (interactive prompt)
   */
  promptUser(jid, text, action, data = {}) {
    this.pendingInputs.set(jid, { action, data });
    return this.send(jid, text);
  }

  // ── Handlers ───────────────────────────────────────────────────────────────
  async _handleStart(jid, msg) {
    const pushName = msg.pushName || "there";
    const text = `🤖 *AgentOS WhatsApp*\n\nWelcome, ${pushName}! I'm your network intelligence assistant.\n`;
    await this.send(jid, text);
    await this._handleMenu(jid);
  }

  async _handleMistakes(jid, msg) {
    const rl = msg._rl || this._checkRateLimit(jid);
    const seconds = Math.ceil((rl.resetTime - Date.now()) / 1000);
    const text = `🛡 *Quota Status*\nYou have *${rl.remaining} mistakes* (actions) available in this window.\nReset in ${seconds}s.`;
    await this.send(jid, text);
  }

  async _handleMenu(jid) {
    const text =
      `🤖 *AgentOS Main Menu*\n\n` +
      `1️⃣ *Dashboard* — System overview\n` +
      `2️⃣ *Users* — Active sessions\n` +
      `3️⃣ *Stats* — Router stats\n` +
      `4️⃣ *Voucher* — Create voucher\n` +
      `5️⃣ *Wallet* — Check balance\n` +
      `6️⃣ *Pay* — Recharge account\n` +
      `7️⃣ *Tools* — Network tools\n` +
      `0️⃣ *Back* — Return to this menu\n\n` +
      `Reply with a number (0-7) to select an option, or type /help for slash commands.`;
    await this.promptUser(jid, text, "ussd_menu");
  }

  async _handleHelp(jid) {
    await this._handleMenu(jid);
  }

  async _handleDashboard(jid, msg, opts = {}) {
    const uid = msg?._uid || jid;
    const context = {
      userId: uid,
      platformId: jid,
      channel: "whatsapp",
      userDoc: msg?.userDoc,
    };
    const { getDatabase } = require("../database");
    const db = await getDatabase();
    const mt = this.agent?.mikrotik || global.mikrotik;

    try {
      let resource = null;
      let activeUsers = [];
      try {
        resource = await mt.executeTool("system.stats", {}, context);
      } catch (err) {
        logger.warn(
          `WhatsApp Dashboard: Could not fetch resource: ${err.message}`,
        );
      }

      try {
        activeUsers = await mt.executeTool("users.active", {}, context);
      } catch (err) {
        logger.warn(
          `WhatsApp Dashboard: Could not fetch active users: ${err.message}`,
        );
      }

      const revenue = (await db
        .getRevenue?.("daily")
        .catch(() => ({ total: 0, count: 0 }))) || { total: 0, count: 0 };
      const wallet = await db
        .getWallet(uid)
        .catch(() => ({ balance: 0, currency: "USD" }));

      const cpu = parseInt(resource?.["cpu-load"] || 0);
      const memTotal = parseInt(resource?.["total-memory"] || 0);
      const memFree = parseInt(resource?.["free-memory"] || 0);
      const memUsedPercent =
        memTotal > 0 ? Math.round(((memTotal - memFree) / memTotal) * 100) : 0;

      const cpuEmoji = Number(cpu) > 80 ? "🔴" : Number(cpu) > 50 ? "🟡" : "🟢";
      const memEmoji =
        memUsedPercent > 80 ? "🔴" : memUsedPercent > 50 ? "🟡" : "🟢";

      const routerStatus = resource
        ? `🖥️ *Router Status*\n` +
        `${cpuEmoji} CPU: *${cpu}%*\n` +
        `${memEmoji} RAM: *${memUsedPercent}%* used\n` +
        `⏱ Uptime: \`${resource?.uptime || "N/A"}\`\n` +
        `📦 OS: \`${resource?.version || "N/A"}\`\n\n`
        : `🖥️ *Router Status*: 🔴 Offline\n\n`;

      const walletLine = `💳 Balance: *${(wallet.balance || 0).toFixed(2)} ${wallet.currency || "USD"}*\n`;

      const text =
        `📊 *AgentOS Dashboard*\n\n${routerStatus}🌐 *Network*\n` +
        `🟢 Active Users: *${activeUsers?.length || 0}*\n\n` +
        `💰 *Finance (Today)*\n` +
        `💵 Revenue: *${revenue.total ? revenue.total.toFixed(2) : "0.00"} USD*\n` +
        `🎫 Sales: *${revenue.count || 0}* vouchers\n${walletLine}\n${resource ? `✅ System healthy` : `⚠️ Router offline`
        }`;

      await this.send(jid, text);
    } catch (err) {
      logger.error("WhatsAppChannel Dashboard error:", err);
      await this.send(jid, `❌ Dashboard error: ${err.message}`);
    }
  }

  async _handleUsers(jid, msg) {
    const uid = msg?._uid || jid;
    const context = {
      userId: uid,
      platformId: jid,
      channel: "whatsapp",
      userDoc: msg?.userDoc,
    };
    const users = await this.agent.executeTool("users.active", {}, context);
    if (!users?.length) {
      await this.send(jid, "👥 No active users found.");
    } else {
      let text = `👥 *Active Users (${users.length})*\n\n`;
      users.slice(0, 15).forEach((u, i) => {
        text += `${i + 1}. *${u.user || u.name}* (${u.address})\n   ⏱ ${u.uptime}\n`;
      });
      if (users.length > 15) text += `\n_...and ${users.length - 15} more_`;
      await this.send(jid, text);
    }
  }

  async _handleVoucher(jid, msg, args) {
    const planId = args[1];
    const { getDatabase } = require("../database");
    const db = await getDatabase();

    const uid = msg._uid || jid;
    const user = await db.getUser(uid);
    const isAdmin = user?.role === "admin" || user?.role === "reseller";

    // If a planId was provided directly
    if (planId) {
      return this._createVoucher(jid, planId, uid);
    }

    // List plans dynamically
    try {
      let plans = await db.getPlans(true);
      if (!plans.length) {
        const { getConfig } = require("../config");
        const cfg = getConfig();
        plans = Array.isArray(cfg.plans)
          ? cfg.plans.filter((p) => p.active !== false)
          : [];
      }

      if (!plans.length) {
        plans = [
          { id: "1Hour", name: "1 Hour", price: 0.5 },
          { id: "1Day", name: "1 Day", price: 1.0 },
          { id: "7Day", name: "7 Days", price: 3.0 },
        ];
      }

      const wallet = await db.getWallet(uid);
      const balance = wallet.balance || 0;
      const currency = wallet.currency || "USD";

      let msgText =
        `🎫 *Create Voucher*\n\n` +
        `Role: *${isAdmin ? "Admin (Free)" : "User"}*\n` +
        `Balance: *${balance} ${currency}*\n\n` +
        `Available Plans:\n`;

      plans.forEach((p) => {
        msgText += `- */voucher ${p.id || p.mikrotikProfile}* (${p.name}: ${p.price} ${currency})\n`;
      });

      msgText += `\n_Type the command for the plan you want._`;
      await this.send(jid, msgText);
    } catch (err) {
      await this.send(jid, `❌ Failed to list plans: ${err.message}`);
    }
  }

  /**
   * Core voucher creation logic (ported/enhanced from Telegram)
   */
  async _createVoucher(jid, planId, uid = null) {
    const { getDatabase } = require("../database");
    const db = await getDatabase();
    // Use resolved UID for DB lookups; fall back to JID if not resolved
    const resolvedId = uid || jid;
    const user = await db.getUser(resolvedId);
    const isAdmin = user?.role === "admin" || user?.role === "reseller";

    const planObj = (await db.getPlan(planId)) || {
      name: "Custom",
      deviceLimit: 1,
      durationUnit: "days",
      durationValue: 1,
    };
    const price = planObj.price || 0;

    if (!isAdmin) {
      const wallet = await db.getWallet(resolvedId);
      if ((wallet.balance || 0) < price) {
        return this.send(
          jid,
          `❌ *Insufficient Balance*\nPlan requires ${price} but you only have ${wallet.balance || 0}. Use */pay* to top up.`,
        );
      }
      // Deduct balance
      await db.updateWallet(resolvedId, {
        balance: (wallet.balance || 0) - price,
      });
    }

    await this.send(
      jid,
      `🎫 Generating *${planObj.name || planId}* voucher...`,
    );

    const voucherAgent = require("../voucher");
    const code = await voucherAgent.generate(planId);

    const mt = this.agent?.mikrotik || global.mikrotik;
    const dateUtils = require("../../utils/date");
    const expiresAt =
      planObj.durationValue && planObj.durationUnit
        ? dateUtils
          .add(new Date(), planObj.durationValue, planObj.durationUnit)
          .toISOString()
        : null;
    const loginUrl = `http://${mt?.state?.host || "hotspot.local"}/login?username=${code}&password=${code}`;

    await db.createVoucher(code, {
      plan: planId,
      planName: planObj.name || planId,
      durationUnit: planObj.durationUnit || null,
      durationValue: planObj.durationValue || null,
      deviceLimit: planObj.deviceLimit || 1,
      expiresAt,
      loginUrl,
      userId: resolvedId,
      createdBy: "whatsapp",
      value: price,
      currency: user?.currency || "USD",
    });

    // Update user subscription record (matching Telegram)
    try {
      await db.updateSubscription(resolvedId, {
        planId,
        planName: planObj.name || planId,
        purchasedAt: new Date().toISOString(),
        expiresAt,
      });
    } catch (subErr) {
      logger.warn(`WhatsApp subscription update failed: ${subErr.message}`);
    }

    if (mt) {
      const _durationToMikrotik = (p) => {
        if (!p || !p.durationValue || !p.durationUnit) return null;
        const v = p.durationValue;
        switch (p.durationUnit) {
          case "weeks":
            return `${v}w`;
          case "days":
            return `${v}d`;
          case "hours":
            return `${String(v).padStart(2, "0")}:00:00`;
          case "minutes":
            return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}:00`;
          default:
            return null;
        }
      };

      await mt
        .addHotspotUser({
          username: code,
          password: code,
          profile: planId,
          sharedUsers: planObj.deviceLimit || 1,
          ...(expiresAt && { limitUptime: _durationToMikrotik(planObj) }),
        })
        .catch((e) =>
          logger.error(`WhatsApp Mikrotik Sync Failed: ${e.message}`),
        );
    }

    // Generate QR
    const QRCode = require("qrcode");
    const qrBuf = await QRCode.toBuffer(loginUrl);

    await this.sendMedia(
      jid,
      qrBuf,
      "image/png",
      `🎫 *Voucher Created*\n\n` +
      `Code: \`${code}\`\n` +
      `Plan: *${planObj.name || planId}*\n` +
      `Expires: ${expiresAt ? new Date(expiresAt).toLocaleString() : "Never"}\n\n` +
      `_Scan the code or login manually at the portal._`,
    );

    // Trigger printing if thermal printer is configured
    try {
      const { printVoucher } = require("../printer");
      await printVoucher({
        username: code,
        password: code,
        profile: planObj.name || planId,
        loginUrl,
        expires: expiresAt,
        price: price,
        currency: user?.currency || "USD",
        duration: planObj.durationValue ? `${planObj.durationValue}${planObj.durationUnit === 'hours' ? 'h' : planObj.durationUnit === 'days' ? 'd' : planObj.durationUnit === 'weeks' ? 'w' : ''}` : undefined
      });
    } catch (e) {
      // Silent fail for printer
    }
  }

  async _handleStats(jid, msg) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    try {
      const uid = msg?._uid || jid;
      const context = { userId: uid, platformId: jid, channel: "whatsapp" };
      const stats = await mt.executeTool("system.stats", {}, context);
      const health = mt.state?.lastKnownHealth || {};

      const text =
        `📊 *Router Statistics*\n\n` +
        `Board: *${stats.board || "MikroTik"}*\n` +
        `Model: \`${stats.model || "N/A"}\`\n` +
        `Version: \`${stats.version || "N/A"}\`\n` +
        `CPU: \`${stats["cpu-load"]}%\` (${stats.cpu || "N/A"})\n` +
        `RAM: \`${stats["free-memory"]} / ${stats["total-memory"]}\`\n` +
        `Disk: \`${stats["free-hdd-space"]} / ${stats["total-hdd-space"]}\`\n` +
        `Uptime: \`${stats.uptime}\`\n\n` +
        `⚡ Voltage: \`${health.voltage || "N/A"}V\`\n` +
        `🌡 Temp: \`${health.temperature || "N/A"}C\``;

      await this.send(jid, text);
    } catch (err) {
      await this.send(jid, `❌ Stats Error: ${err.message}`);
    }
  }

  async _handleKick(jid, msg, args) {
    const target = args[1];
    if (!target) return this.send(jid, "❌ Usage: */kick <username>*");

    const uid = msg?._uid || jid;
    const context = {
      userId: uid,
      platformId: jid,
      channel: "whatsapp",
      userDoc: msg?.userDoc,
    };
    await this.agent.executeTool("user.kick", { target }, context);
    await this.send(jid, `✅ User *${target}* kicked successfully.`);
  }

  async _handleReboot(jid) {
    this.pendingInputs.set(jid, { action: "confirm_reboot" });
    await this.send(
      jid,
      '⚠️ *Confirm System Reboot?*\nAll users will be disconnected. Reply with "yes" to confirm.',
    );
  }

  async _handlePing(jid, msg, args) {
    const host = args[1];
    if (!host) {
      this.pendingInputs.set(jid, { action: "ping" });
      return this.send(jid, "📡 *Ping*\nPlease enter the target IP or host:");
    }

    const mt = this.agent?.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    await this.send(jid, `📡 Pinging ${host}...`);
    try {
      const result = await mt.executeTool("ping", { host, count: 4 });
      await this.send(
        jid,
        `✅ *Ping ${host}*\n\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
      );
    } catch (err) {
      await this.send(jid, `❌ Ping failed: ${err.message}`);
    }
  }

  async _handleDahua(jid, msg, args) {
    const action = args[1] || "list";
    const device = args[2];
    const uid = msg?._uid || jid;
    const context = {
      userId: uid,
      platformId: jid,
      channel: "whatsapp",
      userDoc: msg?.userDoc,
    };

    if (action === "list") {
      const result = await this.agent.executeTool(
        "dahua.device.list",
        {},
        context,
      );
      const response = result
        .map((d) => `- *${d.name}* (${d.id}): ${d.host}`)
        .join("\n");
      await this.send(
        jid,
        `✅ *Dahua Devices*\n\n${response || "No devices found."}`,
      );
    } else if (action === "snapshot") {
      const result = await this.agent.executeTool(
        "dahua.snapshot.get",
        { device },
        context,
      );
      if (result.base64) {
        const imgBuffer = Buffer.from(result.base64, "base64");
        await this.sendMedia(
          jid,
          imgBuffer,
          "image/jpeg",
          `📷 Snapshot: ${device || "Default"}`,
        );
      } else {
        await this.send(jid, `❌ Snapshot failed.`);
      }
    }
  }

  async _handleAsk(jid, msg, args) {
    const query = args.slice(1).join(" ");
    if (!query) return this.send(jid, "❌ Usage: */ask <your question>*");

    // Pass to AI via emit
    this.emit("message", {
      text: query,
      userId: msg._uid || jid,
      platformId: jid,
      userDoc: msg.userDoc,
      sender: msg.pushName || jid.split("@")[0],
      channel: "whatsapp",
      raw: msg,
    });
  }

  async _handleCli(jid, msg, args) {
    const cmd = args.slice(1).join(" ");
    if (!cmd) return this.send(jid, "❌ Usage: */cli <command>*");

    const mt = this.agent?.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    try {
      const res = await mt.executeCLI(cmd);
      await this.send(jid, `💻 *CLI:*\n\`\`\`text\n${res}\n\`\`\``);
    } catch (err) {
      await this.send(jid, `❌ CLI Error: ${err.message}`);
    }
  }

  async _handleApi(jid, msg, args) {
    const cmd = args.slice(1).join(" ");
    if (!cmd) return this.send(jid, "❌ Usage: */api <path>*");

    const mt = this.agent?.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    try {
      const res = await mt.executeRawAPI(cmd);
      await this.send(
        jid,
        `⚙️ *API:*\n\`\`\`json\n${JSON.stringify(res, null, 2)}\n\`\`\``,
      );
    } catch (err) {
      await this.send(jid, `❌ API Error: ${err.message}`);
    }
  }

  async _handleWallet(jid, msg) {
    const { getDatabase } = require("../database");
    const db = await getDatabase();
    // Prefer resolved UID from identity bridging; fall back to JID
    const uid = msg?._uid || jid;
    const wallet = await db.getWallet(uid);
    const balance = wallet.balance || 0;
    const currency = wallet.currency || "USD";

    await this.send(
      jid,
      `👛 *My Wallet*\n\n` +
      `Balance: *${balance} ${currency}*\n` +
      `Status: ✅ Active\n\n` +
      `_Use */pay* to top up your balance instantly via various payment methods._`,
    );
  }

  async _handlePay(jid, msg) {
    await this.send(
      jid,
      `💳 *Recharge Account*\n\n` +
      `1. *M-PESA / Mobile Money*\n` +
      `2. *Credit/Debit Card*\n` +
      `3. *Cash at Counter*\n\n` +
      `_Please enter the amount you wish to top up or visit our web portal for automated payments._`,
    );
  }

  async _handleClaim(jid, msg) {
    const { getDatabase } = require("../database");
    const db = await getDatabase();
    // Use resolved UID if available; the claim stores both JID and UID
    const uid = msg?._uid || jid;
    const user = await db.getUser(uid);

    if (this.config.allowed_ids && this.config.allowed_ids.length > 0) {
      return this.send(
        jid,
        "❌ *Access Denied:* Admin has already been claimed.",
      );
    }

    // Register both the JID and the resolved UID so either can authorize
    this.config.allowed_ids = uid !== jid ? [jid, uid] : [jid];
    logger.info(
      `WhatsAppChannel: JID ${jid} (UID: ${uid}) claimed primary admin status.`,
    );

    await this.send(
      jid,
      `🎉 *Success!* You are now the primary admin (\`${jid}\`).\n\n` +
      `Commands are now strictly restricted to you and authorized personnel.\n` +
      `_Note: Ensure you update your configuration to persist this change._`,
    );
  }

  async _handleToken(jid) {
    const token = process.env.GATEWAY_TOKEN || "Not configured";
    await this.send(
      jid,
      `🔑 *System Access Token*\n\n` +
      `Token: \`${token}\`\n\n` +
      `_Use this for API and WebSocket authentication. Do not share this with anyone!_`,
    );
  }

  async _handleTools(jid, msg) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    try {
      const tools = await mt.getAvailableTools();
      let text = `🛠 *Network Tools*\n\n`;
      tools.forEach((t) => {
        text += `- */tool ${t}*\n`;
      });
      text += `\n_Example: /tool ping 8.8.8.8_`;
      await this.send(jid, text);
    } catch (err) {
      await this.send(jid, `❌ Failed to list tools: ${err.message}`);
    }
  }

  async _handleTool(jid, msg, args) {
    const toolName = args[1];
    if (!toolName) return this._handleTools(jid, msg);

    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    // Simple implementation for common tools
    if (toolName === "ping") {
      return this._handlePing(jid, msg, args);
    }

    await this.send(
      jid,
      `🔧 Tool *${toolName}* is not yet fully optimized for interactive WhatsApp mode. Please use the CLI bridge for raw execution.`,
    );
  }

  async _handleSetupRouter(jid) {
    await this.send(
      jid,
      `🌐 *Router Onboarding*\n\nThis feature guides you through connecting a new MikroTik router to AgentOS. Please visit the web dashboard for the full visual wizard.`,
    );
  }

  async _handleNetwork(jid, msg) {
    const mt = this.agent?.mikrotik || global.mikrotik;
    if (!mt) return this.send(jid, "⚠️ MikroTik not connected.");

    try {
      const uid = msg?._uid || jid;
      const context = { userId: uid, platformId: jid, channel: "whatsapp" };
      const interfaces = (await mt.getInterfaces?.()) || [];
      let text = `🌐 *Network Interfaces*\n\n`;
      interfaces.forEach((i) => {
        const state = i.running === "true" ? "✅" : "❌";
        text += `${state} *${i.name}* (${i.type})\n   Tx: ${i["tx-byte"]} | Rx: ${i["rx-byte"]}\n`;
      });
      if (!interfaces.length) text += "_No interfaces found_";
      await this.send(jid, text);
    } catch (err) {
      await this.send(jid, `❌ Network error: ${err.message}`);
    }
  }

  async _handleStatus(jid) {
    const status = this.getStatus();
    const text =
      `🤖 *System Status*\n\n` +
      `Platform: *AgentOS WhatsApp*\n` +
      `Status: ${status.connected ? "✅ Connected" : "❌ Disconnected"}\n` +
      `Messages: \`${status.messageCount}\`\n` +
      `Errors: \`${status.errorCount}\`\n` +
      `Uptime: \`${Math.floor(process.uptime() / 60)}m\`\n\n` +
      `_Connected as: ${this.sock?.user?.id || "Unknown"}_`;
    await this.send(jid, text);
  }

  async _executePending(jid, msg, { text, action, data }) {
    // Resolve the canonical user identity once for all branches
    const uid = msg._uid || jid;

    if (action === "ussd_menu") {
      const choice = text.trim();
      switch (choice) {
        case "0":
          return this._handleMenu(jid);
        case "1":
          return this._handleDashboard(jid, msg);
        case "2":
          return this._handleUsers(jid, msg);
        case "3":
          return this._handleStats(jid, msg);
        case "4":
          return this._handleVoucher(jid, msg, []);
        case "5":
          return this._handleWallet(jid, msg);
        case "6":
          return this._handlePay(jid, msg);
        case "7":
          return this._handleTools(jid, msg);
        default:
          await this.send(
            jid,
            "❌ Invalid choice. Reply with a number between 0 and 7.",
          );
          return this._handleMenu(jid);
      }
    } else if (action === "confirm_reboot") {
      if (text.toLowerCase() === "yes") {
        await this.send(jid, "⚡ *Rebooting router...*");
        // Use resolved UID so the tool receives the authoritative identity
        const context = {
          userId: uid,
          platformId: jid,
          channel: "whatsapp",
          userDoc: msg.userDoc,
        };
        await this.agent.executeTool(
          "system.reboot",
          { confirm: true },
          context,
        );
      } else {
        await this.send(jid, "❌ Reboot cancelled.");
      }
    } else if (action === "ping") {
      await this._handlePing(jid, msg, ["", text]);
    } else if (action === "dns") {
      await this._handleDns(jid, msg, ["", text]);
    } else if (action === "neighbors") {
      await this._handleNeighbors(jid, msg);
    } else if (action.startsWith("tool:")) {
      const toolName = action.split(":")[1];
      await this._handleTool(jid, msg, [null, toolName, text]);
    }
  }

  /**
   * Alert once pattern for system notifications
   */
  async alertOnce(alertKey, message) {
    const lastSent = this._alertState.get(alertKey);
    const now = Date.now();
    // Send alert if not sent before, or if more than 2 hours have passed
    if (!lastSent || now - lastSent > 2 * 60 * 60 * 1000) {
      this._alertState.set(alertKey, now);
      return this.broadcast(message);
    }
    return { success: true, skipped: true };
  }

  async send(userId, message) {
    if (!this.sock || !this.connected) {
      throw new Error("WhatsApp not connected");
    }

    const jid = this.normalizeJid(userId);
    const content = typeof message === "string" ? { text: message } : message;

    try {
      return await this.sock.sendMessage(jid, content);
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to send WhatsApp message to ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send media message
   */
  async sendMedia(userId, buffer, mimeType, caption = "") {
    if (!this.sock || !this.connected) {
      throw new Error("WhatsApp not connected");
    }

    const jid = this.normalizeJid(userId);
    let messageContent = {};

    if (mimeType.startsWith("image/")) {
      messageContent = { image: buffer, caption };
    } else if (mimeType.startsWith("video/")) {
      messageContent = { video: buffer, caption };
    } else if (mimeType.startsWith("audio/")) {
      messageContent = { audio: buffer, mimetype: mimeType };
    } else {
      messageContent = { document: buffer, caption, mimetype: mimeType };
    }

    try {
      return await this.sock.sendMessage(jid, messageContent);
    } catch (error) {
      this.errorCount++;
      logger.error(`Failed to send WhatsApp media to ${userId}:`, error);
      throw error;
    }
  }

  async broadcast(message) {
    const { getChatRegistry } = require("../chat-registry");
    const chats = getChatRegistry().getChats("whatsapp");
    const content = typeof message === "string" ? { text: message } : message;

    logger.info(`WhatsAppChannel: broadcasting to ${chats.length} chats`);
    for (const jid of chats) {
      if (this.sock && this.connected) {
        this.sock.sendMessage(jid, content).catch((err) => {
          logger.error(`WhatsApp broadcast failed for ${jid}: ${err.message}`);
        });
      }
    }
  }

  getStatus() {
    return {
      ...super.getStatus(),
      type: "whatsapp",
      hasQR: !!this.qrCode,
      authorizedJids: Array.from(this.allowedJids),
    };
  }

  async destroy() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.sock) {
      try {
        this.sock.end(new Error("System shutdown"));
      } catch (e) {
        logger.error(
          `Error during WhatsApp shutdown: ${e.message || "Unknown error"}`,
          e,
        );
      }
      this.sock = null;
    }
    global._whatsappChannelActive = false;
    await super.destroy();
  }
  async _handleTransfer(jid, msg, args) {
    const identifier = args[1];
    const planId = args[2];

    const { getDatabase } = require("../database");
    const db = await getDatabase();
    const currentUser = await db.getUser(msg._uid || jid);
    const isAdmin =
      currentUser?.role === "admin" || currentUser?.role === "reseller";

    if (!isAdmin) return this.send(jid, "❌ *Access Denied:* Admin required.");
    if (!identifier)
      return this.send(jid, "❌ Usage: */transfer <user> [planId]*");

    try {
      const targetUser = await db.resolveUser(identifier);
      if (!targetUser)
        return this.send(jid, `❌ User *${identifier}* not found.`);

      if (!planId) {
        return this.send(
          jid,
          `❌ Please specify a plan ID. Example: \`/transfer ${identifier} 1Day\``,
        );
      }

      const plans = await db.getPlans();
      const plan = plans.find(
        (p) => p.mikrotikProfile === planId || p.id === planId,
      );
      if (!plan) return this.send(jid, `❌ Plan *${planId}* not found.`);

      const voucherAgent = require("../voucher");
      const code = await voucherAgent.generate(planId);

      await db.createVoucher(code, {
        plan: planId,
        duration: plan.durationValue
          ? `${plan.durationValue}${plan.durationUnit || ""}`
          : "24h",
        userId: targetUser.id,
        createdAt: new Date(),
        createdBy: `whatsapp:${jid}`,
      });

      if (plan.price > 0) {
        await db.updateUser(targetUser.id, {
          credits: (targetUser.credits || 0) + plan.price,
        });
        await db.logAudit("voucher.transfer", `whatsapp:${jid}`, {
          targetId: targetUser.id,
          code,
          price: plan.price,
        });
      }

      const text =
        `🎁 *Transfer Success*\n\n` +
        `Recipient: *${targetUser.fullname || targetUser.username || targetUser.id}*\n` +
        `Plan: *${plan.name}*\n` +
        `Code: \`${code}\`\n\n` +
        `_The user has been credited and can now use this voucher._`;

      await this.send(jid, text);

      // Notify target if on WhatsApp
      if (targetUser.channels?.whatsapp) {
        this.send(
          targetUser.channels.whatsapp,
          `🎁 *Gift Received!*\nYou have been sent a *${plan.name}* voucher.\nCode: \`${code}\``,
        ).catch(() => { });
      }
    } catch (err) {
      this.send(jid, `❌ Transfer failed: ${err.message}`);
    }
  }
}

BaseChannel.register("whatsapp", WhatsAppChannel);
module.exports = WhatsAppChannel;
