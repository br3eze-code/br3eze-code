'use strict';

import { jest } from '@jest/globals';

// ── Mock logger (guardHotspot uses logger, not console.error) ─────────────────
jest.unstable_mockModule('../../src/core/logger.js', () => ({
    logger: {
        info:  jest.fn(),
        warn:  jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        cyber: jest.fn(),
        audit: jest.fn()
    }
}));

const { logger } = await import('../../src/core/logger.js');
const { default: UniversalBilling } = await import('../../src/adapters/payments/universal-billing.js');

// ── Shared factory helpers ────────────────────────────────────────────────────

/** Build a mockDb whose PHASE 2/3 lists are empty by default */
function makeDb(overrides = {}) {
    return {
        getVoucher:          jest.fn().mockResolvedValue(null),
        resolveUser:         jest.fn().mockResolvedValue(null),
        expireVoucher:       jest.fn().mockResolvedValue(true),
        getVouchersByStatus: jest.fn().mockResolvedValue([]),
        getUsersByStatus:    jest.fn().mockResolvedValue([]),
        ...overrides
    };
}

function makeMikrotik(overrides = {}) {
    return {
        state:             { isConnected: true },
        executeTool:       jest.fn().mockResolvedValue([]),
        disableHotspotUser: jest.fn().mockResolvedValue({ success: true }),
        enableHotspotUser:  jest.fn().mockResolvedValue({ success: true }),
        ...overrides
    };
}

describe('UniversalBilling — guardHotspot / reaper', () => {
    let billing, mockDb, mockMikrotik;

    beforeEach(() => {
        mockDb       = makeDb();
        mockMikrotik = makeMikrotik();
        global.mikrotik = mockMikrotik;
        billing = new UniversalBilling({ database: mockDb, mikrotik: mockMikrotik });
    });

    afterEach(() => {
        delete global.mikrotik;
        jest.clearAllMocks();
    });

    test('smoke: guardHotspot resolves without throwing when nothing to do', async () => {
        mockMikrotik.executeTool.mockResolvedValue([]);
        await expect(billing.guardHotspot()).resolves.toBeUndefined();
    });

    test('kicks active users whose voucher is expired', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => {
            if (tool === 'users.report') return [
                { username: 'user1', isActive: true,  disabled: false },
                { username: 'user2', isActive: true,  disabled: false }
            ];
            return { kicked: true };
        });
        mockDb.getVoucher.mockImplementation(async (u) => ({ code: u, status: 'active', expiresAt: new Date(Date.now() - 1000).toISOString() }));
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'time_expired' });
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.kick', { username: 'user1' });
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.kick', { username: 'user2' });
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user1');
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user2');
    });

    test('does NOT kick an inactive user, but still expires them in DB', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => tool === 'users.report' ? [{ username: 'idle', isActive: false, disabled: false }] : {});
        mockDb.getVoucher.mockResolvedValue({ code: 'idle', status: 'active' });
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'time_expired' });
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.kick', expect.anything());
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', { username: 'idle' });
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('idle');
    });

    test('continues processing remaining users if kicking user throws for one', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool, args) => {
            if (tool === 'users.report') return [
                { username: 'user1', isActive: true, disabled: false },
                { username: 'user2', isActive: true, disabled: false }
            ];
            if (tool === 'user.kick' && args.username === 'user1') throw new Error('Router ID missing');
            return { kicked: true };
        });
        mockDb.getVoucher.mockImplementation(async (u) => ({ code: u, status: 'active' }));
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'test' });
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.kick', { username: 'user2' });
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user2');
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to process user user1'), expect.objectContaining({ error: 'Router ID missing' }));
        expect(mockDb.expireVoucher).not.toHaveBeenCalledWith('user1');
    });

    test('re-enables a user that is disabled on router but has a valid voucher', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => tool === 'users.report' ? [{ username: 'valid', isActive: false, disabled: true }] : {});
        mockDb.getVoucher.mockResolvedValue({ code: 'valid', status: 'active', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: false, reason: null });
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).toHaveBeenCalledWith('user.enable', { username: 'valid' });
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
        expect(mockDb.expireVoucher).not.toHaveBeenCalled();
    });

    test('never touches system users (admin, default, root)', async () => {
        mockMikrotik.executeTool.mockImplementation(async (tool) => tool === 'users.report' ? [
            { username: 'admin', isActive: true, disabled: false },
            { username: 'default', isActive: true, disabled: false },
            { username: 'root', isActive: true, disabled: false }
        ] : {});
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'time_expired' });
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.kick', expect.anything());
        expect(billing.checkVoucherStatus).not.toHaveBeenCalled();
    });

    test('PHASE 2: ignores users whose voucher is already marked expired in DB since disable logic is commented out', async () => {
        mockMikrotik.executeTool.mockResolvedValue([]);
        mockDb.getVouchersByStatus.mockImplementation(async (status) => status === 'expired' ? [{ code: 'old1' }, { code: 'old2' }] : []);
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
    });

    test('PHASE 3: expires DB-active vouchers that have passed their expiry date but does not disable them', async () => {
        mockMikrotik.executeTool.mockResolvedValue([]);
        mockDb.getVouchersByStatus.mockImplementation(async (status) => status === 'active' ? [{ code: 'stale', expiresAt: new Date(Date.now() - 5000).toISOString() }] : []);
        await billing.guardHotspot();
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('stale');
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
    });

    test('skips run gracefully when MikroTik is not connected', async () => {
        mockMikrotik.state.isConnected = false;
        await billing.guardHotspot();
        expect(mockMikrotik.executeTool).not.toHaveBeenCalled();
        expect(mockMikrotik.executeTool).not.toHaveBeenCalledWith('user.disable', expect.anything());
    });
});
