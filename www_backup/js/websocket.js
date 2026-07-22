/**
 * AgentOS WiFi Manager - WebSocket Client
 * Version: 2026.5.0
 * Features: Real-time communication with server gateway
 */

class AgentOSWebSocket {
    constructor() {
        this.ws = null;
        this.serverUrl = '';
        this.token = '';
        this.reconnectAttempts = 0;
        this.maxReconnect = CONFIG.WS_MAX_RECONNECT;
        this.reconnectInterval = CONFIG.WS_RECONNECT_INTERVAL;
        this.listeners = new Map();
        this.connected = false;
        this.heartbeatInterval = null;
        this.lastPong = 0;
        /** Firebase UID injected by auth.js after sign-in */
        this._firebaseUid = null;
        this._firebaseEmail = null;
        /**
         * Stable, persistent client ID stored in localStorage.
         * Survives reconnects so the backend channels.websocket entry
         * is always linked to the same identifier instead of creating a
         * new orphaned UUID on every connection (which caused the
         * duplicate-UUID / channel-mismatch issue).
         */
        this.clientId = AgentOSWebSocket._loadOrCreateClientId();
    }

    /**
     * Returns a stable UUID for this browser/device, persisted in localStorage.
     * Uses crypto.randomUUID() where available (all modern browsers), falls back
     * to a Math.random-based v4-like UUID so the format stays consistent.
     */
    static _loadOrCreateClientId() {
        const KEY = 'agentos_ws_client_id';
        let id = localStorage.getItem(KEY);
        if (!id) {
            if (typeof crypto !== 'undefined' && crypto.randomUUID) {
                id = crypto.randomUUID();
            } else {
                // RFC-4122 v4 fallback
                id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                    const r = Math.random() * 16 | 0;
                    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                });
            }
            localStorage.setItem(KEY, id);
        }
        return id;
    }

    /**
     * Inject the currently signed-in Firebase user so the backend
     * WebSocketChannel._rl() can call resolveFirebaseUser() and link
     * channels.websocket to the canonical Firebase UID — exactly the same
     * flow used by TelegramChannel._rl() and BaseChannel identity bridging.
     * Call this from auth.js after firebase.auth().onAuthStateChanged.
     */
    setFirebaseUser(user) {
        if (!user) {
            this._firebaseUid = null;
            this._firebaseEmail = null;
            return;
        }
        this._firebaseUid = user.uid || null;
        this._firebaseEmail = user.email || null;
        // If already connected, send an identity frame immediately
        if (this.isConnected()) {
            this._sendIdentify();
        }
    }

    /** Send auth.identify so the server can call getUserByChannel / resolveFirebaseUser */
    _sendIdentify() {
        if (!this._firebaseUid) return;
        this.send({
            type: 'auth.identify',
            uid: this._firebaseUid,
            email: this._firebaseEmail || undefined,
            channel: 'websocket',
            // Include our stable clientId so the server can upsert
            // channels.websocket = clientId rather than the ephemeral
            // server-generated UUID, preventing duplicate channel entries.
            clientId: this.clientId
        });
    }

    setConfig(serverUrl, token) {
        this.serverUrl = serverUrl.replace(/^http/, 'ws');
        this.token = token;
    }

    async connect() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('[WebSocket] Already connected');
            return true;
        }

        return new Promise((resolve, reject) => {
            // Include stable clientId AND Firebase UID so WebSocketChannel._rl()
            // can bridge identity without creating a new UUID each reconnect.
            let wsUrl = `${this.serverUrl}/ws?token=${encodeURIComponent(this.token)}&clientId=${encodeURIComponent(this.clientId)}`;
            if (this._firebaseUid) wsUrl += `&uid=${encodeURIComponent(this._firebaseUid)}`;

            console.log('[WebSocket] Connecting to:', wsUrl.split('?')[0] + '?token=***');

            try {
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    console.log('[WebSocket] Connected');
                    this.connected = true;
                    this.reconnectAttempts = 0;

                    // Start heartbeat
                    this.startHeartbeat();

                    // Bridge Firebase identity to the backend channel mapper
                    // WebSocketChannel._rl() will call resolveFirebaseUser() and
                    // write channels.websocket = clientId — same as Telegram does.
                    this._sendIdentify();

                    // Notify listeners
                    this.emit('connected');

                    resolve(true);
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleMessage(data);
                    } catch (e) {
                        console.error('[WebSocket] Parse error:', e);
                    }
                };

                this.ws.onclose = (event) => {
                    console.log('[WebSocket] Disconnected:', event.code, event.reason);
                    this.connected = false;
                    this.stopHeartbeat();
                    this.emit('disconnected', event);

                    // Reconnect if not intentional close
                    if (event.code !== 1000) {
                        this.scheduleReconnect();
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('[WebSocket] Error:', error);
                    this.emit('error', error);
                    reject(error);
                };

                // Timeout after 10 seconds
                setTimeout(() => {
                    if (!this.connected) {
                        this.ws.close();
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

            } catch (error) {
                console.error('[WebSocket] Connection failed:', error);
                reject(error);
            }
        });
    }

    handleMessage(data) {
        switch (data.type) {
            case 'hello':
                console.log('[WebSocket] Server greeting:', data.payload);
                // Re-send identity after hello so backend can bridge channel on reconnect
                this._sendIdentify();
                this.emit('hello', data.payload);
                break;

            case 'pong':
                this.lastPong = Date.now();
                break;

            case 'tool.result':
            case 'tool.error':
                this.emit('tool.result', data);
                break;

            case 'broadcast':
                this.emit('broadcast', data);
                break;
            
            case 'qr':
                console.log('[WebSocket] QR code received');
                this.emit('qr', data.payload);
                break;

            case 'subscribed':
                this.emit('subscribed', data);
                break;

            case 'auth.identified':
                // Server confirmed identity bridge — channels.websocket linked to Firebase UID
                console.log('[WebSocket] Identity bridged to UID:', data.uid);
                this.emit('auth.identified', data);
                break;

            case 'intent.result':
                this.emit('intent.result', data);
                break;

            case 'error':
                console.error('[WebSocket] Server error:', data.error);
                this.emit('server.error', data);
                break;

            default:
                console.log('[WebSocket] Unknown message type:', data.type);
        }
    }

    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            console.warn('[WebSocket] Cannot send - not connected');
        }
    }

    async executeTool(tool, params = []) {
        return new Promise((resolve, reject) => {
            const id = this.generateId();

            const timeout = setTimeout(() => {
                reject(new Error('Tool execution timeout'));
            }, 30000);

            const handler = (data) => {
                if (data.id === id) {
                    clearTimeout(timeout);
                    this.off('tool.result', handler);

                    if (data.success) {
                        resolve(data.result);
                    } else {
                        reject(new Error(data.error));
                    }
                }
            };

            this.on('tool.result', handler);

            this.send({
                type: 'tool.invoke',
                id,
                tool,
                params
            });
        });
    }

    subscribe(channel) {
        this.send({
            type: 'subscribe',
            channel
        });
    }

    listTools() {
        return new Promise((resolve, reject) => {
            const handler = (data) => {
                this.off('tool.list', handler);
                resolve(data.tools);
            };

            this.on('tool.list', handler);
            this.send({ type: 'tool.list' });

            // Timeout
            setTimeout(() => {
                this.off('tool.list', handler);
                resolve([]);
            }, 5000);
        });
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.lastPong = Date.now();

        this.heartbeatInterval = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.send({ type: 'ping' });

                // Check if we received a pong recently
                if (Date.now() - this.lastPong > 60000) {
                    console.warn('[WebSocket] No pong received - reconnecting');
                    this.ws.close();
                }
            }
        }, 30000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnect) {
            console.error('[WebSocket] Max reconnect attempts reached');
            this.emit('reconnect.failed');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectInterval * Math.min(this.reconnectAttempts, 5);

        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.connect().catch(() => { });
        }, delay);
    }

    disconnect() {
        this.stopHeartbeat();
        if (this.ws) {
            this.ws.close(1000, 'Client disconnect');
            this.ws = null;
        }
        this.connected = false;
    }

    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // Event emitter methods
    on(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
    }

    off(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (e) {
                    console.error('[WebSocket] Event handler error:', e);
                }
            });
        }
    }

    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Global WebSocket instance
const wsClient = new AgentOSWebSocket();

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.AgentOSWebSocket = AgentOSWebSocket;
    window.wsClient = wsClient;
}
