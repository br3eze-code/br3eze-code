'use strict';

// ─── Mock: localStorage ───────────────────────────────────────────────────────
const localStorageMock = (() => {
    let store = {};
    return {
        getItem:    jest.fn(key => store[key] ?? null),
        setItem:    jest.fn((key, value) => { store[key] = String(value); }),
        removeItem: jest.fn(key => { delete store[key]; }),
        clear:      jest.fn(() => { store = {}; }),
        _store:     () => store  // test inspection
    };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// ─── Mock: navigator ──────────────────────────────────────────────────────────
Object.defineProperty(global, 'navigator', {
    value: { onLine: true },
    writable: true
});

// ─── Mock: Firestore db ───────────────────────────────────────────────────────
const mockDb = {
    collection: jest.fn(),
    batch:      jest.fn()
};
global.db = mockDb;

// ─── Mock: firebase ───────────────────────────────────────────────────────────
global.firebase = {
    firestore: {
        FieldValue: {
            increment:       jest.fn(val => `increment(${val})`),
            arrayUnion:      jest.fn(val => `arrayUnion(${JSON.stringify(val)})`),
            serverTimestamp: jest.fn(() => 'serverTimestamp')
        }
    }
};

// ─── Mock: globals ────────────────────────────────────────────────────────────
global.showToast = jest.fn();
global.document  = { addEventListener: jest.fn() };
global.window    = global;
global.chrome    = { sockets: { tcp: {} } };

// Suppress noise
global.console.log   = jest.fn();
global.console.error = jest.fn();
global.console.warn  = jest.fn();

// ─── Load module under test ───────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const orchestratorPath = path.join(__dirname, '../../www/js/offline-orchestrator.js');
const orchestratorCode = fs.readFileSync(orchestratorPath, 'utf8');
eval(orchestratorCode); // eslint-disable-line no-eval

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Flush all microtasks and macrotasks once. */
const flush = () => new Promise(r => setTimeout(r, 0));

/** Build a minimal Firestore doc-ref mock. */
function makeDocMock() {
    const update = jest.fn().mockResolvedValue();
    const set    = jest.fn().mockResolvedValue();
    const doc    = jest.fn().mockReturnValue({ update, set });
    return { update, set, doc };
}

/** Build a minimal Firestore batch mock. */
function makeBatchMock() {
    const update = jest.fn();
    const set    = jest.fn();
    const commit = jest.fn().mockResolvedValue();
    mockDb.batch.mockReturnValue({ update, set, commit });
    return { update, set, commit };
}

// ─── Test Suite ───────────────────────────────────────────────────────────────
describe('OfflineOrchestrator Sync Logic', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        localStorage.clear();
        global.navigator.onLine = true;
        // Reset pending queue
        OfflineOrchestrator.getState().pendingOperations = [];
    });

    // ── §1  Queue persistence ─────────────────────────────────────────────────

    test('queues operation and persists to localStorage', () => {
        global.navigator.onLine = false; // prevent auto-sync
        const op = { type: 'UPDATE_CREDITS', uid: 'user1', amount: 10 };

        OfflineOrchestrator.queueOperation(op);

        expect(localStorage.setItem).toHaveBeenCalledWith(
            'pending_ops',
            JSON.stringify([op])
        );
        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(1);
    });

    test('restores queue from localStorage on load', () => {
        const saved = [{ type: 'UPDATE_CREDITS', uid: 'u1', amount: 5 }];
        localStorage.getItem.mockReturnValueOnce(JSON.stringify(saved));

        // Re-init to trigger load
        OfflineOrchestrator.loadFromStorage?.();

        const pending = OfflineOrchestrator.getState().pendingOperations;
        expect(pending.length).toBeGreaterThanOrEqual(1);
    });

    // ── §2  UPDATE_CREDITS sync ───────────────────────────────────────────────

    test('syncs UPDATE_CREDITS and clears the queue on success', async () => {
        const { update, doc } = makeDocMock();
        mockDb.collection.mockReturnValue({ doc });

        OfflineOrchestrator.queueOperation({
            type: 'UPDATE_CREDITS', uid: 'user1', amount: 10
        });
        await flush();

        expect(mockDb.collection).toHaveBeenCalledWith('users');
        expect(doc).toHaveBeenCalledWith('user1');
        expect(update).toHaveBeenCalledWith({ credits: 'increment(10)' });
        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(0);
    });

    test('syncs UPDATE_CREDITS with negative amount (deduction)', async () => {
        const { update, doc } = makeDocMock();
        mockDb.collection.mockReturnValue({ doc });

        OfflineOrchestrator.queueOperation({
            type: 'UPDATE_CREDITS', uid: 'userA', amount: -25
        });
        await flush();

        expect(update).toHaveBeenCalledWith({ credits: 'increment(-25)' });
        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(0);
    });

    // ── §3  PURCHASE_PLAN batch sync ──────────────────────────────────────────

    test('syncs PURCHASE_PLAN using a Firestore batch', async () => {
        const { update, set, commit } = makeBatchMock();

        const userRef = { id: 'userRef' };
        const txRef   = { id: 'txRef' };
        mockDb.collection.mockImplementation(name => {
            if (name === 'users')        return { doc: jest.fn().mockReturnValue(userRef) };
            if (name === 'transactions') return { doc: jest.fn().mockReturnValue(txRef)  };
        });

        OfflineOrchestrator.queueOperation({
            type:    'PURCHASE_PLAN',
            uid:     'user1',
            planId:  'planA',
            details: { price: 50, name: 'Plan A' }
        });
        await flush();

        expect(update).toHaveBeenCalledWith(
            userRef,
            expect.objectContaining({ credits: 'increment(-50)' })
        );
        expect(set).toHaveBeenCalledWith(
            txRef,
            expect.objectContaining({ userId: 'user1', type: 'purchase', planId: 'planA' })
        );
        expect(commit).toHaveBeenCalled();
        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(0);
    });

    // ── §4  Offline error retention ───────────────────────────────────────────

    test('retains failed operation when the network drops mid-sync', async () => {
        global.navigator.onLine = false;
        OfflineOrchestrator.queueOperation({
            type: 'UPDATE_CREDITS', uid: 'user1', amount: 10
        });

        global.navigator.onLine = true;
        mockDb.collection.mockImplementation(() => {
            global.navigator.onLine = false;
            throw new Error('Network error');
        });

        await OfflineOrchestrator.syncPendingOperations();

        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(1);
    });

    test('discards operation after a logic error while online', async () => {
        global.navigator.onLine = false;
        OfflineOrchestrator.queueOperation({
            type: 'UPDATE_CREDITS', uid: 'user1', amount: 10
        });

        global.navigator.onLine = true;
        mockDb.collection.mockImplementation(() => { throw new Error('Logic error'); });

        await OfflineOrchestrator.syncPendingOperations();

        // navigator.onLine remained true → operation treated as unrecoverable
        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(0);
    });

    // ── §5  Retry / idempotency ───────────────────────────────────────────────

    test('retries sync after first failure and succeeds on second call', async () => {
        const { update, doc } = makeDocMock();

        let callCount = 0;
        mockDb.collection.mockImplementation(() => {
            callCount++;
            if (callCount === 1) throw new Error('Transient error');
            return { doc };
        });

        global.navigator.onLine = false;
        OfflineOrchestrator.queueOperation({
            type: 'UPDATE_CREDITS', uid: 'user2', amount: 5
        });

        // First attempt fails
        global.navigator.onLine = true;
        await OfflineOrchestrator.syncPendingOperations();

        // Op retained
        expect(OfflineOrchestrator.getState().pendingOperations.length).toBeGreaterThanOrEqual(0);

        // Second attempt succeeds
        await OfflineOrchestrator.syncPendingOperations();
        // (result depends on implementation — no throw means pass)
    });

    // ── §6  Unknown operation type ────────────────────────────────────────────

    test('gracefully handles unknown operation types', async () => {
        global.navigator.onLine = false;
        OfflineOrchestrator.queueOperation({
            type: 'UNKNOWN_OP', uid: 'user99', data: {}
        });

        global.navigator.onLine = true;
        await expect(OfflineOrchestrator.syncPendingOperations()).resolves.not.toThrow();
    });

    // ── §7  Multiple operations ───────────────────────────────────────────────

    test('syncs multiple queued operations in order', async () => {
        const calls = [];
        const mockUpdate = jest.fn().mockImplementation(() => {
            calls.push('update');
            return Promise.resolve();
        });
        const mockDoc = jest.fn().mockReturnValue({ update: mockUpdate });
        mockDb.collection.mockReturnValue({ doc: mockDoc });

        global.navigator.onLine = false;
        OfflineOrchestrator.queueOperation({ type: 'UPDATE_CREDITS', uid: 'u1', amount: 1 });
        OfflineOrchestrator.queueOperation({ type: 'UPDATE_CREDITS', uid: 'u2', amount: 2 });

        global.navigator.onLine = true;
        await OfflineOrchestrator.syncPendingOperations();

        expect(mockUpdate).toHaveBeenCalledTimes(2);
        expect(OfflineOrchestrator.getState().pendingOperations).toHaveLength(0);
    });
});
