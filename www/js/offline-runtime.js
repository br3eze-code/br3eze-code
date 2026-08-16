/* AgentOS offline-first runtime. No passwords, provider secrets, or access tokens are stored here. */
(function initAgentOSOffline(global) {
    'use strict';

    const DB_NAME = 'agentos-offline-v1';
    const DB_VERSION = 1;
    const SNAPSHOTS = 'snapshots';
    const OUTBOX = 'outbox';
    const SECRET_KEYS = /password|passcode|secret|token|api[-_]?key|private[-_]?key|authorization|card(number|cvc|cvv)/i;
    const memory = { snapshots: new Map(), outbox: new Map() };

    const id = () => global.crypto?.randomUUID?.() || `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const now = () => new Date().toISOString();
    const clean = (value) => {
        if (Array.isArray(value)) return value.map(clean);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value).filter(([key]) => !SECRET_KEYS.test(key)).map(([key, item]) => [key, clean(item)]));
    };

    function openDb() {
        if (!global.indexedDB) return Promise.resolve(null);
        return new Promise((resolve) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'key' });
                if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id' });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
        });
    }

    async function store(name, mode, action) {
        const db = await openDb();
        if (!db) return action(null);
        return new Promise((resolve) => {
            const tx = db.transaction(name, mode);
            const result = action(tx.objectStore(name));
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => resolve(undefined);
        });
    }

    function context() {
        let current = {};
        try { current = JSON.parse(localStorage.getItem('agentos_offline_context') || '{}'); } catch { current = {}; }
        return {
            userId: current.userId || localStorage.getItem('mesh_uid') || null,
            tenantId: current.tenantId || localStorage.getItem('agentos_tenant_id') || 'local-offline-tenant',
            siteId: current.siteId || localStorage.getItem('agentos_site_id') || null,
            role: current.role || 'user',
            channel: 'www',
            location: { available: false, reason: 'offline-runtime-does-not-collect-location' },
            online: global.navigator?.onLine !== false
        };
    }

    function setContext(next = {}) {
        const safe = clean({
            userId: next.userId || next.uid || null,
            tenantId: next.tenantId || next.tenant || null,
            siteId: next.siteId || next.site || null,
            role: next.role || 'user'
        });
        localStorage.setItem('agentos_offline_context', JSON.stringify(safe));
        return context();
    }

    async function putSnapshot(key, value) {
        const record = { key, value: clean(value), updatedAt: now() };
        memory.snapshots.set(key, record);
        await store(SNAPSHOTS, 'readwrite', (objects) => objects?.put(record));
        return record.value;
    }

    async function getSnapshot(key) {
        const memoryValue = memory.snapshots.get(key);
        if (memoryValue) return memoryValue.value;
        const db = await openDb();
        if (!db) return null;
        return new Promise((resolve) => {
            const request = db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(key);
            request.onsuccess = () => resolve(request.result?.value ?? null);
            request.onerror = () => resolve(null);
        });
    }

    async function queueMutation(operation, payload, options = {}) {
        const item = {
            id: options.idempotencyKey || id(),
            operation,
            payload: clean(payload),
            context: context(),
            createdAt: now(),
            attempts: 0,
            status: 'pending'
        };
        memory.outbox.set(item.id, item);
        await store(OUTBOX, 'readwrite', (objects) => objects?.put(item));
        global.dispatchEvent(new CustomEvent('agentos:offline-queued', { detail: { ...item, payload: undefined } }));
        return { offline: true, queued: true, acknowledged: false, idempotencyKey: item.id, status: 'pending' };
    }

    async function outboxItems() {
        const db = await openDb();
        if (!db) return [...memory.outbox.values()];
        return new Promise((resolve) => {
            const request = db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => resolve([...memory.outbox.values()]);
        });
    }

    async function request(url, options = {}) {
        const method = (options.method || 'GET').toUpperCase();
        const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(method);
        const requestOptions = { ...options, headers: { ...(options.headers || {}), 'X-AgentOS-Context-Mode': 'offline-capable' } };
        try {
            if (!global.navigator?.onLine && mutating) return queueMutation(options.operation || `${method} ${url}`, options.body, options);
            const response = await fetch(url, requestOptions);
            if (response.ok) return response;
            if (mutating && (response.status === 404 || response.status === 502 || response.status === 503)) {
                return queueMutation(options.operation || `${method} ${url}`, options.body, options);
            }
            return response;
        } catch (error) {
            if (mutating) return queueMutation(options.operation || `${method} ${url}`, options.body, options);
            const cached = await getSnapshot(`GET:${url}`);
            if (cached !== null) return new Response(JSON.stringify(cached), { status: 200, headers: { 'Content-Type': 'application/json', 'X-AgentOS-Offline': 'snapshot' } });
            throw error;
        }
    }

    async function sync() {
        if (!global.navigator?.onLine) return { synced: 0, pending: (await outboxItems()).length };
        const endpoint = global.ENV?.AGENTOS_SYNC_URL || '/api/v1/sync';
        const items = await outboxItems();
        let synced = 0;
        for (const item of items) {
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': item.id, 'X-AgentOS-Context-Mode': 'offline-replay' },
                    body: JSON.stringify(item)
                });
                if (!response.ok) break;
                memory.outbox.delete(item.id);
                await store(OUTBOX, 'readwrite', (objects) => objects?.delete(item.id));
                synced += 1;
            } catch { break; }
        }
        global.dispatchEvent(new CustomEvent('agentos:offline-sync', { detail: { synced, pending: items.length - synced } }));
        return { synced, pending: items.length - synced };
    }

    global.AgentOSOffline = Object.freeze({ context, clean, setContext, getSnapshot, putSnapshot, queueMutation, request, sync, outboxItems, isOffline: () => global.navigator?.onLine === false });
    global.addEventListener('online', () => sync());
    global.addEventListener('offline', () => global.dispatchEvent(new CustomEvent('agentos:offline-state', { detail: { online: false } })));
    global.addEventListener('load', () => { if (global.navigator?.serviceWorker) global.navigator.serviceWorker.register('sw.js').catch(() => {}); });
})(window);
