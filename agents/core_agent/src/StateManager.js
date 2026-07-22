/**
 * StateManager - Distributed state with CRDT-based conflict resolution
 */

const CryptoUtils = require('../../../shared/utils/CryptoUtils');

class StateManager {
    constructor() {
        this.states = new Map();
        this.vectors = new Map(); // Vector clocks for CRDT
        this.persistence = null;
        this.encryption = null;
        this.syncAdapter = null;
    }

    async initialize(options = {}) {
        if (options.persistence) {
            this.persistence = new (require('../../../sync/local_storage/IndexedDBManager'))();
            await this.persistence.open('powerconnect_states', 1);
        }

        if (options.encryption) {
            this.encryption = CryptoUtils;
        }

        if (options.sync) {
            this.syncAdapter = new (require('../../../sync/firebase_sync/FirebaseAdapter'))();
            await this.syncAdapter.connect();
            
            // Setup sync listeners
            this.syncAdapter.on('state_update', (update) => {
                this.mergeRemoteState(update);
            });
        }
    }

    async set(key, value, options = {}) {
        const timestamp = Date.now();
        const vector = this.incrementVector(key);

        let data = value;
        if (this.encryption && options.encrypt !== false) {
            data = await this.encryption.encrypt(JSON.stringify(value));
        }

        const state = {
            key,
            data,
            timestamp,
            vector,
            checksum: await this.calculateChecksum(value),
            metadata: options.metadata || {}
        };

        this.states.set(key, state);

        if (this.persistence) {
            await this.persistence.put('states', state);
        }

        if (this.syncAdapter && options.sync !== false) {
            await this.syncAdapter.pushState(state);
        }

        return state;
    }

    async get(key, options = {}) {
        let state = this.states.get(key);

        if (!state && this.persistence) {
            state = await this.persistence.get('states', key);
            if (state) this.states.set(key, state);
        }

        if (!state) return null;

        let data = state.data;
        if (this.encryption && state.encrypted !== false) {
            data = JSON.parse(await this.encryption.decrypt(data));
        }

        return {
            key: state.key,
            value: data,
            timestamp: state.timestamp,
            vector: state.vector,
            metadata: state.metadata
        };
    }

    async mergeRemoteState(remoteUpdate) {
        const local = this.states.get(remoteUpdate.key);
        
        if (!local) {
            // No local conflict, accept remote
            this.states.set(remoteUpdate.key, remoteUpdate);
            return;
        }

        // CRDT: Last-Write-Wins with vector clock comparison
        const comparison = this.compareVectors(local.vector, remoteUpdate.vector);
        
        if (comparison === 'remote') {
            this.states.set(remoteUpdate.key, remoteUpdate);
            this.emit('state:merged', { key: remoteUpdate.key, winner: 'remote' });
        } else if (comparison === 'concurrent') {
            // Merge conflict - apply custom merge strategy
            const merged = await this.resolveConflict(local, remoteUpdate);
            this.states.set(remoteUpdate.key, merged);
            this.emit('state:conflict_resolved', { key: remoteUpdate.key, merged });
        }
    }

    compareVectors(v1, v2) {
        // Simplified vector clock comparison
        const keys = new Set([...Object.keys(v1), ...Object.keys(v2)]);
        let v1Greater = false;
        let v2Greater = false;

        for (const key of keys) {
            const val1 = v1[key] || 0;
            const val2 = v2[key] || 0;
            
            if (val1 > val2) v1Greater = true;
            if (val2 > val1) v2Greater = true;
        }

        if (v1Greater && !v2Greater) return 'local';
        if (v2Greater && !v1Greater) return 'remote';
        if (!v1Greater && !v2Greater) return 'equal';
        return 'concurrent';
    }

    async resolveConflict(local, remote) {
        // Custom conflict resolution: prioritize billing state, merge usage data
        if (local.key.startsWith('billing:')) {
            // For billing, keep the one with higher usage (more conservative)
            const localUsage = local.data.totalUsage || 0;
            const remoteUsage = remote.data.totalUsage || 0;
            return localUsage > remoteUsage ? local : remote;
        }

        // Default: merge objects
        return {
            ...local,
            data: { ...local.data, ...remote.data },
            vector: { ...local.vector, ...remote.vector },
            timestamp: Math.max(local.timestamp, remote.timestamp)
        };
    }

    incrementVector(key) {
        const current = this.vectors.get(key) || {};
        const nodeId = this.getNodeId();
        return {
            ...current,
            [nodeId]: (current[nodeId] || 0) + 1
        };
    }

    getNodeId() {
        return `node-${Math.random().toString(36).substr(2, 9)}`;
    }

    async calculateChecksum(data) {
        const str = JSON.stringify(data);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString(16);
    }

    emit(event, data) {
        // Event emission for state changes
    }

    async close() {
        if (this.persistence) await this.persistence.close();
        if (this.syncAdapter) await this.syncAdapter.disconnect();
    }
}

module.exports = StateManager;