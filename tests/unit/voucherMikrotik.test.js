import { jest } from '@jest/globals';
import crypto from 'crypto';
const mkVouchers = () => new Map();
function makeDb(vouchersMap = mkVouchers()) { return { db: null, _vouchers: vouchersMap, getPlan: jest.fn().mockResolvedValue({ name: '1 Day', mikrotikProfile: '1day', durationValue: 1, durationUnit: 'days', deviceLimit: 1, price: 1 }), createVoucher: jest.fn().mockImplementation(async (code, data) => { vouchersMap.set(code, { code, ...data, status: 'active', used: false }); return code; }), getVoucher: jest.fn().mockImplementation(async (code) => vouchersMap.get(code) || null), getWallet: jest.fn().mockResolvedValue({ balance: 10, currency: 'USD' }), deductCredits: jest.fn().mockResolvedValue(true), getUser: jest.fn().mockResolvedValue({ role: 'user', currency: 'USD' }), _saveLocal: jest.fn() }; }
jest.unstable_mockModule('../../src/core/database.js', () => ({ getDatabase: jest.fn().mockResolvedValue({ getVoucher: jest.fn().mockResolvedValue(null), createVoucher: jest.fn().mockResolvedValue('STAR-MOCK-123') }) }));
describe('VoucherService.generate', () => {
  let voucher;
  beforeEach(async () => { jest.resetModules(); ({ default: voucher } = await import('../../src/services/vouchers.js')); });
  test('returns a STAR-prefixed string', async () => expect(await voucher.generate('1day')).toMatch(/^STAR-/));
  test('generates unique codes', async () => { const codes = new Set(); for (let i = 0; i < 50; i++) codes.add(await voucher.generate('1day')); expect(codes.size).toBe(50); });
  test('throws for unknown plan', async () => await expect(voucher.generate('nonexistent-xyz')).rejects.toThrow(/Invalid plan/i));
  test('accepts canonical profiles', async () => { for (const p of ['default', '1hour', '1day', '1week', '30day', '7day']) await expect(voucher.generate(p)).resolves.toBeDefined(); });
  test('emits voucher.created', async () => { const { default: eventBus } = await import('../../src/core/eventBus.js'); const h = jest.fn(); eventBus.on('voucher.created', h); const code = await voucher.generate('1day'); expect(h).toHaveBeenCalledWith(expect.objectContaining({ code, plan: '1day' })); eventBus.removeAllListeners('voucher.created'); });
});
function hashPlanId(name) { return crypto.createHash('sha256').update(name.trim()).digest('hex').substring(0, 16); }
describe('Voucher metadata helpers', () => {
  test('hashPlanId is stable and bounded', () => { expect(hashPlanId('1 Day')).toHaveLength(16); expect(hashPlanId('1 Day')).toBe(hashPlanId('1 Day')); });
  test('local voucher schema keeps required fields', async () => { const map = mkVouchers(); const db = makeDb(map); await db.createVoucher('STAR-TEST-0001', { plan: hashPlanId('1 Day'), planName: '1 Day', durationValue: 1, durationUnit: 'days', deviceLimit: 1, expiresAt: '2099-01-01T00:00:00.000Z', createdBy: '123456789', value: 1, currency: 'USD' }); const saved = map.get('STAR-TEST-0001'); expect(saved.planName).toBe('1 Day'); expect(saved.used).toBe(false); expect(saved.createdBy).not.toBe('telegram'); });
});
