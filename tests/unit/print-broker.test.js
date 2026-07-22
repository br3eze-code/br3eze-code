'use strict';

const { PrintBroker } = require('../../src/core/print-broker');
const printer = require('../../src/core/printer');

jest.mock('../../src/core/printer', () => ({
    _printVoucherDirect: jest.fn()
}));

jest.mock('../../src/core/logger', () => ({
    logger: { 
        info: (...args) => console.log('INFO:', ...args), 
        warn: (...args) => console.log('WARN:', ...args), 
        debug: (...args) => console.log('DEBUG:', ...args), 
        error: (...args) => console.log('ERROR:', ...args) 
    }
}));

// Mock ws
jest.mock('ws', () => ({
    WebSocket: { OPEN: 1 }
}));

describe('PrintBroker Cordova Sync Logic', () => {
    let broker;
    let mockWsChannel;
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();
        // Reset singleton (there is no reset method, so we instantiate directly or hack it)
        const RealPrintBroker = jest.requireActual('../../src/core/print-broker').PrintBroker;
        broker = new RealPrintBroker();
        broker.MOBILE_TIMEOUT_MS = 1000;

        mockClient = {
            ws: { send: jest.fn(), readyState: 1 },
            capabilities: { printer: 'ble' },
            platform: 'android'
        };

        mockWsChannel = {
            on: jest.fn(),
            wss: { on: jest.fn() },
            clients: new Map([
                ['client123', mockClient]
            ])
        };
    });

    test('should route to server printer if no mobile clients available', async () => {
        mockWsChannel.clients.clear();
        broker.attachWebSocketChannel(mockWsChannel);
        printer._printVoucherDirect.mockResolvedValueOnce({ success: true });

        const result = await broker.print({ username: 'test' });
        expect(result).toEqual({ success: true, via: 'server' });
        expect(printer._printVoucherDirect).toHaveBeenCalled();
    });

    test('should route to mobile client and handle success ACK', async () => {
        broker.attachWebSocketChannel(mockWsChannel);
        
        // Setup ACK injection
        const voucherPromise = broker.print({ username: 'test' });
        
        // Need to simulate receiving the ACK
        await new Promise(resolve => setTimeout(resolve, 10)); // wait for send to be called
        
        expect(mockClient.ws.send).toHaveBeenCalled();
        const payload = JSON.parse(mockClient.ws.send.mock.calls[0][0]);
        expect(payload.type).toBe('print.voucher');
        expect(payload.jobId).toBeDefined();

        // Simulate ACK
        broker._handleMobileAck({ jobId: payload.jobId, success: true });

        const result = await voucherPromise;
        expect(result).toEqual({ success: true, via: 'mobile' });
        expect(printer._printVoucherDirect).not.toHaveBeenCalled();
    });

    test('should route to mobile client and handle failure ACK, then fallback to server', async () => {
        broker.attachWebSocketChannel(mockWsChannel);
        printer._printVoucherDirect.mockResolvedValueOnce({ success: true });
        
        const voucherPromise = broker.print({ username: 'failtest' });
        
        await new Promise(resolve => setTimeout(resolve, 10));
        const payload = JSON.parse(mockClient.ws.send.mock.calls[0][0]);
        
        // Simulate failure ACK
        broker._handleMobileAck({ jobId: payload.jobId, success: false, error: 'paper_out' });

        const result = await voucherPromise;
        
        // If mobileResult is not success, it falls through to server logic
        expect(result).toEqual({ success: true, via: 'server' });
        expect(printer._printVoucherDirect).toHaveBeenCalled();
    });

    test('should timeout waiting for mobile ACK and fallback to server', async () => {
        broker.attachWebSocketChannel(mockWsChannel);
        printer._printVoucherDirect.mockResolvedValueOnce({ success: true });
        
        const voucherPromise = broker.print({ username: 'timeouttest' });
        
        // Don't send ACK, wait for timeout
        const result = await voucherPromise;
        
        expect(result).toEqual({ success: true, via: 'server' });
        expect(printer._printVoucherDirect).toHaveBeenCalled();
    });
});
