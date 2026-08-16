import TelegramBot from 'node-telegram-bot-api';
import crypto from 'node:crypto';

const DEFAULT_PLANS = Object.freeze([
  { id: '1Hour', label: '1 Hour', price: 0.5, durationUnit: 'hours', durationValue: 1 },
  { id: '1Day', label: '1 Day', price: 2, durationUnit: 'days', durationValue: 1 },
  { id: '7Day', label: '7 Days', price: 10, durationUnit: 'days', durationValue: 7 },
  { id: '30Day', label: '30 Days', price: 35, durationUnit: 'days', durationValue: 30 },
]);

const SERVICES = Object.freeze([
  { id: 'wifi', label: 'WiFi Voucher' },
  { id: 'data', label: 'Data Bundle' },
  { id: 'cctv', label: 'CCTV Install' },
  { id: 'service', label: 'Service Call' },
]);

function normalizePhone(value) {
  let phone = String(value || '').trim().replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(phone)) phone = `+263${phone.slice(1)}`;
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) return null;
  return phone;
}

function safeMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) throw new Error('Invalid sale amount');
  return Math.round(amount * 100) / 100;
}

export class PartnerBotFactory {
  constructor({
    db,
    botConstructor = TelegramBot,
    botOptions = { polling: true },
    paymentService = null,
    paymentAdapter = null,
    escrowFactory = null,
    rbac = null,
    logger = console,
    plans = DEFAULT_PLANS,
    stateTtlMs = 15 * 60 * 1000,
  } = {}) {
    if (!db) throw new TypeError('PartnerBotFactory requires db');
    this.db = db;
    this.Bot = botConstructor;
    this.botOptions = botOptions;
    this.paymentService = paymentService;
    this.paymentAdapter = paymentAdapter;
    this.escrowFactory = escrowFactory;
    this.rbac = rbac;
    this.logger = logger;
    this.plans = plans;
    this.stateTtlMs = stateTtlMs;
    this.bots = new Map();
    this.states = new Map();
  }

  async createBot(partner) {
    this._validatePartner(partner);
    if (this.bots.has(partner.id)) return this.bots.get(partner.id);

    const bot = new this.Bot(partner.telegramBotToken, this.botOptions);
    const stateKey = String(partner.id);
    this._registerHandlers(bot, partner, stateKey);
    this.bots.set(stateKey, bot);
    this.logger.info?.(`[PartnerBotFactory] ${partner.name || stateKey} bot active`);
    return bot;
  }

  stopBot(partnerId) {
    const id = String(partnerId);
    const bot = this.bots.get(id);
    if (!bot) return false;
    if (typeof bot.stopPolling === 'function') bot.stopPolling();
    this.bots.delete(id);
    this.states.delete(id);
    return true;
  }

  _validatePartner(partner) {
    if (!partner?.id) throw new TypeError('partner.id is required');
    if (!partner.telegramBotToken) throw new TypeError('partner.telegramBotToken is required');
    if (!partner.commission || !Number.isFinite(Number(partner.commission.voucher))) {
      throw new TypeError('partner.commission.voucher is required');
    }
    const commission = Number(partner.commission.voucher);
    if (commission < 0 || commission > 1) throw new TypeError('partner commission must be between 0 and 1');
  }

  _state(partnerId, chatId) {
    const key = `${partnerId}:${chatId}`;
    const current = this.states.get(key);
    if (current && Date.now() - current.updatedAt < this.stateTtlMs) return current;
    const next = { updatedAt: Date.now() };
    this.states.set(key, next);
    return next;
  }

  _clearState(partnerId, chatId) {
    this.states.delete(`${partnerId}:${chatId}`);
  }

  _registerHandlers(bot, partner, partnerId) {
    bot.onText(/^\/start(?:@\w+)?$/, (msg) => this._sendMain(bot, partner, msg.chat.id));
    bot.on('callback_query', async (query) => {
      try {
        await bot.answerCallbackQuery?.(query.id);
        await this._handleCallback(bot, partner, partnerId, query);
      } catch (error) {
        this.logger.warn?.(`[PartnerBotFactory] callback failed: ${error.message}`);
        await bot.sendMessage(query.message?.chat?.id, 'Unable to complete that action. Please try again.').catch(() => {});
      }
    });
    bot.on('message', async (msg) => {
      if (!msg.text || msg.text.startsWith('/')) return;
      const state = this.states.get(`${partnerId}:${msg.chat.id}`);
      if (!state || state.step !== 'customer_phone') return;
      const phone = normalizePhone(msg.text);
      if (!phone) {
        await bot.sendMessage(msg.chat.id, 'Enter a valid customer phone number, for example +263771234567.');
        return;
      }
      state.customerPhone = phone;
      state.step = 'confirm';
      state.updatedAt = Date.now();
      await this._sendConfirmation(bot, partner, msg.chat.id, state);
    });
  }

  async _handleCallback(bot, partner, partnerId, query) {
    const chatId = query.message?.chat?.id;
    const messageId = query.message?.message_id;
    if (!chatId) return;
    const data = String(query.data || '');
    const state = this._state(partnerId, chatId);
    state.updatedAt = Date.now();

    if (data === 'sale:start') return this._selectService(bot, chatId, messageId);
    if (data === 'wallet:view') return this._showWallet(bot, partner, chatId, messageId);
    if (data === 'stock:view') return this._showStock(bot, partner, chatId, messageId);
    if (data === 'nav:main') return this._sendMain(bot, partner, chatId, messageId);
    if (data === 'sale:cancel') {
      this._clearState(partnerId, chatId);
      return this._edit(bot, chatId, messageId, 'Sale cancelled.', this._mainKeyboard());
    }
    if (data.startsWith('sale:service:')) {
      const serviceId = data.slice('sale:service:'.length);
      if (!SERVICES.some((item) => item.id === serviceId)) throw new Error('Unknown service');
      state.service = serviceId;
      state.step = 'plan';
      return this._edit(bot, chatId, messageId, 'Select a plan:', this._planKeyboard());
    }
    if (data.startsWith('sale:plan:')) {
      const planId = data.slice('sale:plan:'.length);
      const plan = this.plans.find((item) => item.id === planId);
      if (!plan) throw new Error('Unknown plan');
      state.plan = plan;
      state.step = 'customer_phone';
      return bot.sendMessage(chatId, 'Enter the customer phone number.');
    }
    if (data === 'sale:confirm') return this._confirmSale(bot, partner, partnerId, chatId, messageId, state);
    throw new Error('Unknown partner callback');
  }

  async _sendMain(bot, partner, chatId, messageId = null) {
    const brand = partner.brand || {};
    const text = `*${this._escape(brand.displayName || partner.name || 'Partner Sales')}*\n${this._escape(brand.tagline || 'Fast. Reliable. Connected.')}\n\nChoose an operation.`;
    const keyboard = this._mainKeyboard();
    return messageId ? this._edit(bot, chatId, messageId, text, keyboard) : bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: keyboard } });
  }

  _mainKeyboard() {
    return [[{ text: 'New Sale', callback_data: 'sale:start' }], [{ text: 'My Stock', callback_data: 'stock:view' }], [{ text: 'Wallet', callback_data: 'wallet:view' }]];
  }

  async _selectService(bot, chatId, messageId) {
    const keyboard = SERVICES.map((service) => [{ text: service.label, callback_data: `sale:service:${service.id}` }]);
    return this._edit(bot, chatId, messageId, 'What does the customer need?', keyboard);
  }

  _planKeyboard() {
    return this.plans.map((plan) => [{ text: `${plan.label} - $${Number(plan.price).toFixed(2)}`, callback_data: `sale:plan:${plan.id}` }]);
  }

  async _sendConfirmation(bot, partner, chatId, state) {
    const total = safeMoney(state.plan.price);
    const share = Math.round(total * Number(partner.commission.voucher) * 100) / 100;
    state.total = total;
    state.partnerShare = share;
    return bot.sendMessage(chatId, `Sale summary\nService: ${state.service}\nPlan: ${state.plan.label}\nCustomer: ${state.customerPhone}\nTotal: $${total.toFixed(2)}\nPartner share: $${share.toFixed(2)}`, { reply_markup: { inline_keyboard: [[{ text: 'Confirm and charge', callback_data: 'sale:confirm' }], [{ text: 'Cancel', callback_data: 'sale:cancel' }]] } });
  }

  async _confirmSale(bot, partner, partnerId, chatId, messageId, state) {
    if (state.step !== 'confirm' || !state.customerPhone || !state.plan) throw new Error('Sale session expired');
    const reference = `PARTNER-${partnerId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const metadata = { partnerId, service: state.service, plan: state.plan.id, customerPhone: state.customerPhone };
    let payment;
    if (this.escrowFactory) {
      const escrow = await this.escrowFactory({ partner, metadata });
      const job = await escrow.createJob(partnerId, state.customerPhone, [{ name: `${state.service} ${state.plan.id}`, price: state.total }]);
      payment = await escrow.collectPayment(job.escrowId);
      payment = { ...payment, reference, escrowId: job.escrowId };
    } else if (this.paymentService?.purchaseVoucher) {
      payment = await this.paymentService.purchaseVoucher({ userId: partnerId, voucherType: state.plan.id, amount: state.total, currency: partner.currency || 'USD', paymentMethod: partner.paymentProvider || 'paynow', customerPhone: state.customerPhone, metadata });
    } else if (this.paymentAdapter?.initiatePaynow) {
      payment = await this.paymentAdapter.initiatePaynow({ amount: state.total, reference, customerPhone: state.customerPhone, metadata });
    } else {
      throw new Error('No payment service configured');
    }
    await bot.sendMessage(chatId, `Payment initiated. Reference: ${this._escape(String(payment.reference || payment.transactionId || reference))}`, { parse_mode: 'MarkdownV2' });
    this._clearState(partnerId, chatId);
    return payment;
  }

  async _showWallet(bot, partner, chatId, messageId) {
    const wallet = await this.db.getWallet(partner.id);
    return this._edit(bot, chatId, messageId, `Wallet\nAvailable: $${Number(wallet.balance || 0).toFixed(2)}\nCurrency: ${wallet.currency || partner.currency || 'USD'}`, [[{ text: 'Back', callback_data: 'nav:main' }]]);
  }

  async _showStock(bot, partner, chatId, messageId) {
    const stock = typeof this.db.getPartnerInventory === 'function' ? await this.db.getPartnerInventory(partner.id) : [];
    const text = stock.length ? stock.map((item) => `${item.qty || 0}x ${item.name || item.id}`).join('\n') : 'No stock recorded.';
    return this._edit(bot, chatId, messageId, `Stock\n${text}`, [[{ text: 'Back', callback_data: 'nav:main' }]]);
  }

  async _edit(bot, chatId, messageId, text, keyboard) {
    if (!messageId || typeof bot.editMessageText !== 'function') return bot.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
    return bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: keyboard } });
  }

  _escape(value) {
    return String(value).replace(/[\\_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }
}

export { DEFAULT_PLANS, SERVICES, normalizePhone };
export default PartnerBotFactory;
