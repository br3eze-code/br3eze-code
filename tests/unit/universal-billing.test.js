const UniversalBilling = require('../../src/core/universal-billing');

describe('UniversalBilling Reaper Stress Test', () => {
    let billing;
    let mockDb;
    let mockMikrotik;

    beforeEach(() => {
        mockDb = {
            getVoucher: jest.fn(),
            resolveUser: jest.fn(),
            expireVoucher: jest.fn()
        };
        mockMikrotik = {
            state: { isConnected: true },
            executeTool: jest.fn(),
            removeHotspotUser: jest.fn()
        };
        global.mikrotik = mockMikrotik;
        billing = new UniversalBilling({ database: mockDb, mikrotik: mockMikrotik });
    });

    afterEach(() => {
        delete global.mikrotik;
        jest.clearAllMocks();
    });

    test('simple print test', () => {
        console.log('HELLO WORLD');
        expect(true).toBe(true);
    });

    test('reaper should continue processing if one user removal fails', async () => {
        // Mock report with 2 users
        mockMikrotik.executeTool.mockResolvedValue([
            { username: 'user1', isActive: true },
            { username: 'user2', isActive: true }
        ]);

        // Mock getVoucher so expireVoucher gets called
        mockDb.getVoucher.mockImplementation(async (username) => ({
            code: username,
            status: 'active'
        }));

        // Mock status check to expire both
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'test' });

        // First user fails removal (throws exception)
        mockMikrotik.removeHotspotUser.mockImplementation((user) => {
            if (user === 'user1') throw new Error('Simulated failure');
            return { status: 'success' };
        });

        // Mock console.error to avoid noise in test output
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        await billing.reapExpiredVouchers();

        // Should have tried to remove both
        expect(mockMikrotik.removeHotspotUser).toHaveBeenCalledWith('user1');
        expect(mockMikrotik.removeHotspotUser).toHaveBeenCalledWith('user2');

        // Should have expired second user in DB
        expect(mockDb.expireVoucher).toHaveBeenCalledWith('user2');
        
        // Verify we logged the error for user1
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('[Enforcement] Failed to process user user1:'),
            'Simulated failure'
        );

        consoleSpy.mockRestore();
    });

    test('reaper should handle MikroTik returning failure status gracefully', async () => {
        mockMikrotik.executeTool.mockResolvedValue([{ username: 'user1', isActive: false }]);
        billing.checkVoucherStatus = jest.fn().mockResolvedValue({ expired: true, reason: 'test' });
        
        mockDb.getVoucher.mockImplementation(async (username) => ({
            code: username,
            status: 'active'
        }));

        // Mock removeHotspotUser to return 'failed' status (as per our previous hardening)
        mockMikrotik.removeHotspotUser.mockImplementation(async () => {
            throw new Error('Could not resolve router ID');
        });

        await billing.reapExpiredVouchers();

        // Should have called removeHotspotUser
        expect(mockMikrotik.removeHotspotUser).toHaveBeenCalledWith('user1');
        
        // Should NOT have tried to expire in DB because removal threw
        expect(mockDb.expireVoucher).not.toHaveBeenCalled();
    });
});
