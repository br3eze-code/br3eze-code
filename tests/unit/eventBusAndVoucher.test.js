'use strict';
import { jest } from '@jest/globals';
import { EventEmitter } from 'events';

describe('EventBus', () => {
  let eventBus;
  beforeEach(async () => { jest.resetModules(); ({ default: eventBus } = await import('../../src/core/eventBus.js')); });
  afterEach(() => eventBus.removeAllListeners());
  test('is an EventEmitter', () => expect(eventBus).toBeInstanceOf(EventEmitter));
  test('emits and receives events', () => { const h = jest.fn(); eventBus.on('test.event', h); eventBus.emit('test.event', { data: 42 }); expect(h).toHaveBeenCalledWith({ data: 42 }); });
  test('supports multiple listeners', () => { const h1 = jest.fn(), h2 = jest.fn(); eventBus.on('multi', h1); eventBus.on('multi', h2); eventBus.emit('multi', 'payload'); expect(h1).toHaveBeenCalledWith('payload'); expect(h2).toHaveBeenCalledWith('payload'); });
  test('once listeners fire once', () => { const h = jest.fn(); eventBus.once('oneshot', h); eventBus.emit('oneshot'); eventBus.emit('oneshot'); expect(h).toHaveBeenCalledTimes(1); });
  test('removeAllListeners clears listeners', () => { const h = jest.fn(); eventBus.on('cleared', h); eventBus.removeAllListeners('cleared'); eventBus.emit('cleared'); expect(h).not.toHaveBeenCalled(); });
  test('emitting with no listeners is safe', () => expect(() => eventBus.emit('nobody.listening', { x: 1 })).not.toThrow());
});

jest.unstable_mockModule('../../src/core/database.js', () => ({
  getDatabase: jest.fn().mockResolvedValue({ getVoucher: jest.fn().mockResolvedValue(null), createVoucher: jest.fn().mockResolvedValue('STAR-MOCK-123') })
}));

describe('VoucherService', () => {
  let voucher;
  beforeEach(async () => { jest.resetModules(); ({ default: voucher } = await import('../../src/services/vouchers.js')); });
  test('generates a STAR-prefixed code', async () => expect(await voucher.generate('default')).toMatch(/^STAR-/));
  test('generates unique codes', async () => { const codes = new Set(); for (let i = 0; i < 20; i++) codes.add(await voucher.generate()); expect(codes.size).toBe(20); });
  test('throws for invalid plan', async () => await expect(voucher.generate('invalid-plan')).rejects.toThrow(/Invalid plan/i));
  test('emits voucher.created', async () => { const { default: eventBus } = await import('../../src/core/eventBus.js'); const h = jest.fn(); eventBus.on('voucher.created', h); const code = await voucher.generate(); expect(h).toHaveBeenCalledWith(expect.objectContaining({ code })); eventBus.removeAllListeners('voucher.created'); });
  test('redeem validates input', async () => { await expect(voucher.redeem(null, 'user')).rejects.toThrow(/code and user/i); });
});
