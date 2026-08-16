import { jest } from '@jest/globals';
import { PartnerBotFactory, normalizePhone } from '../src/services/partner/bot-factory.mjs';

class FakeBot {
  constructor() {
    this.handlers = new Map();
    this.messages = [];
    this.edits = [];
  }
  onText(pattern, handler) { this.handlers.set(`text:${pattern}`, handler); }
  on(event, handler) { this.handlers.set(event, handler); }
  async sendMessage(chatId, text, options) { this.messages.push({ chatId, text, options }); return { message_id: 1 }; }
  async editMessageText(text, options) { this.edits.push({ text, options }); return { message_id: options.message_id }; }
  async answerCallbackQuery() {}
}

describe('PartnerBotFactory', () => {
  const db = {
    async getWallet() { return { balance: 10, currency: 'USD' }; },
    async getPartnerInventory() { return [{ name: '1 Day', qty: 4 }]; },
  };

  test('normalizes accepted and rejects invalid phone numbers', () => {
    expect(normalizePhone('+263 771 234 567')).toBe('+263771234567');
    expect(normalizePhone('0771234567')).toBe('+263771234567');
    expect(normalizePhone('not-a-phone')).toBeNull();
  });

  test('creates one scoped bot per partner and renders branded start menu', async () => {
    const factory = new PartnerBotFactory({ db, botConstructor: FakeBot });
    const partner = { id: 'p1', name: 'Partner One', telegramBotToken: 'token', commission: { voucher: 0.7 } };
    const bot = await factory.createBot(partner);
    expect(await factory.createBot(partner)).toBe(bot);

    await bot.handlers.get('text:/^\\/start(?:@\\w+)?$/')( { chat: { id: 7 } } );
    expect(bot.messages[0].text).toContain('Partner One');
    expect(bot.messages[0].options.reply_markup.inline_keyboard[0][0].callback_data).toBe('sale:start');
  });

  test('runs service and plan selection, validates phone, and initiates injected payment', async () => {
    const paymentAdapter = { initiatePaynow: jest.fn().mockResolvedValue({ status: 'pending', reference: 'pay-1' }) };
    const factory = new PartnerBotFactory({ db, botConstructor: FakeBot, paymentAdapter });
    const partner = { id: 'p2', name: 'Partner Two', telegramBotToken: 'token', commission: { voucher: 0.8 } };
    const bot = await factory.createBot(partner);
    const callback = bot.handlers.get('callback_query');
    const message = { chat: { id: 8 }, message_id: 2 };

    await callback({ id: 'q1', data: 'sale:start', message });
    await callback({ id: 'q2', data: 'sale:service:wifi', message });
    await callback({ id: 'q3', data: 'sale:plan:1Day', message });
    const messageHandler = bot.handlers.get('message');
    await messageHandler({ chat: { id: 8 }, text: '+263771234567' });
    await callback({ id: 'q4', data: 'sale:confirm', message });

    expect(paymentAdapter.initiatePaynow).toHaveBeenCalledWith(expect.objectContaining({ amount: 2, customerPhone: '+263771234567' }));
    expect(bot.messages.at(-1).text).toContain('Payment initiated');
  });
});
