/* ==========================================================
Backend Server Remote WebSocket Bridge
   ========================================================== */
window.BackendBridge = {
    ws: null,
    reconnectDelay: 3000,
    _connected: false,
    _reconnectTimer: null,

    /** Update the header status badge visible in the nav */
    _setStatus(online) {
        this._connected = online;
        const badge = document.getElementById('backendStatusBadge');
        if (!badge) return;
        badge.title = online ? 'Gateway: Online' : 'Gateway: Offline';
        badge.className = 'backend-status-badge ' + (online ? 'status-online' : 'status-offline');
    },

    connect: function () {
        // Don't reconnect if the app is backgrounded
        if (window.isAppPaused) return;

        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

        let host = window.location.host;

        // If loaded via file:// (Cordova) or empty hostname, default to gateway port
        if (window.location.protocol === 'file:' || window.location.hostname === '') {
            host = `127.0.0.1:${(window.ENV && window.ENV.GATEWAY_PORT) || '3000'}`;
        }

        // Use gateway configuration if available and different from the current page's port
        if (window.ENV) {
            if (window.ENV.GATEWAY_PORT && window.location.port !== window.ENV.GATEWAY_PORT) {
                host = `${window.location.hostname || '127.0.0.1'}:${window.ENV.GATEWAY_PORT}`;
            } else if (window.ENV.GATEWAY_URL) {
                try {
                    const envUrl = new URL(window.ENV.GATEWAY_URL);
                    if (window.location.host !== envUrl.host) {
                        host = envUrl.host;
                    }
                } catch (e) { }
            }
        }

        const token = (window.ENV && window.ENV.GATEWAY_TOKEN) || '';
        const wsUrl = `${protocol}//${host}/ws${token ? '?token=' + encodeURIComponent(token) : ''}`;
        console.log(`[BackendBridge] Connecting to: ${protocol}//${host}/ws`);
        this.ws = new WebSocket(wsUrl);
        this.ws.onopen = () => {
            console.log('[BackendBridge] WebSocket Connected');
            this.reconnectDelay = 3000; // Reset delay on successful connection
            this._setStatus(true);
        };
        this.ws.onmessage = (e) => {
            try {
                const response = JSON.parse(e.data);
                // Server-sent ping — respond immediately
                if (response.type === 'ping') {
                    this.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    return;
                }
                if (response.type === 'hello') {
                    // Gateway greeted us — we are confirmed online
                    this._setStatus(true);
                    return;
                }
                console.log('[BackendBridge] Message from Backend:', response);
                safeShowToast(response.message || 'Action Completed', response.type === 'error' ? 'error' : 'success');
            } catch (err) { }
        };
        this.ws.onclose = () => {
            this._setStatus(false);
            console.log(`[BackendBridge] WebSocket Disconnected. Reconnecting in ${this.reconnectDelay / 1000}s...`);
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => {
                this.connect();
                // Exponential backoff up to 30s
                this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
            }, this.reconnectDelay);
        };
        this.ws.onerror = (err) => {
            this._setStatus(false);
            console.warn('[BackendBridge] WebSocket connection offline or failed to reach local gateway daemon.');
        };
    },
    sendIntent: async function (intentName, payload) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            let extra = {};
            if (typeof WifiWizard2 !== 'undefined') {
                try {
                    extra.ssid = await window.NetworkTools.getCleanSSID();
                    if (typeof WifiWizard2.getConnectedBSSID === 'function') {
                        extra.bssid = await WifiWizard2.getConnectedBSSID();
                    }
                } catch (e) { }
            }
            this.ws.send(JSON.stringify({ type: 'intent', intent: intentName, payload: { ...payload, ...extra } }));
        } else {
            console.warn('[BackendBridge] WS Offline. Intent queued or failed.', intentName);
            safeShowToast('Backend Offline. Cannot perform action.', 'error');
        }
    },
    executeTool: function (toolName, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return reject(new Error('Backend Offline'));
            }
            const id = Math.random().toString(36).substring(7);
            let settled = false;
            const settle = (fn, val) => {
                if (settled) return;
                settled = true;
                this.ws.removeEventListener('message', handler);
                fn(val);
            };
            const handler = (e) => {
                try {
                    const response = JSON.parse(e.data);
                    if (response.type === 'tool.result' && response.id === id) {
                        if (response.success) {
                            if (response.result && response.result.success === false) {
                                settle(reject, new Error(response.result.error || 'Tool execution failed'));
                            } else {
                                settle(resolve, response.result);
                            }
                        } else {
                            settle(reject, new Error(response.error));
                        }
                    }
                } catch (err) { }
            };
            this.ws.addEventListener('message', handler);
            this.ws.send(JSON.stringify({ type: 'tool.invoke', id, tool: toolName, params }));

            // Timeout after 30s — always cleans up handler
            setTimeout(() => settle(reject, new Error('Tool invocation timed out')), 30000);
        });
    }
};
// Initiate connection: defer until after deviceready on Cordova,
// or immediately in a plain browser context.
if (typeof cordova !== 'undefined') {
    document.addEventListener('deviceready', () => window.BackendBridge.connect(), false);
} else {
    window.BackendBridge.connect();
}

/* ==========================================================
   Global Intent Dispatcher (AgentOS AI Orchestrator link)
   ========================================================== */
window.dispatchGlobalIntent = async function (intentName, payload) {
    console.log(`[Intent Dispatch] ${intentName}`, payload);

    // Relay exact intent to the backend Node.js Server
    window.BackendBridge.sendIntent(intentName, payload);
};





/* ==========================================================
   6. AGENT ORCHESTRATOR (AgentOS Core)
   ========================================================== */
window.AgentOrchestrator = {
    initialized: false,
    agents: {},

    async init() {
        if (this.initialized) return;
        console.log('[AgentOS] Initializing Orchestrator...');

        // Register Core Agents (Represented here for the UI)
        this.agents.wifi = {
            name: 'WiFiAgent',
            status: 'active',
            lastScan: Date.now()
        };

        this.agents.billing = {
            name: 'BillingAgent',
            status: 'active'
        };

        // Initialize Distributed Gossip Node
        this.agents.gossip = {
            name: 'GossipAgent',
            status: 'syncing',
            peers: 0
        };

        // 1. Initialize Plugin CoreAgent if available
        if (typeof CoreAgent !== 'undefined') {
            const agent = CoreAgent.getInstance ? CoreAgent.getInstance() : CoreAgent;
            if (agent.initialize) agent.initialize();
            if (typeof EventBus !== 'undefined' && agent.setEventBus) agent.setEventBus(EventBus);
        }

        this.initialized = true;
        EventBus.emit('orchestrator:ready', { timestamp: Date.now() });

        // Listen for AI recommendations
        EventBus.on('ai:recommendation', (data) => {
            console.log('[AgentOS] AI Recommendation Received:', data);
            if (window.showToast) {
                window.showToast(`🤖 AI: ${data.message}`, 'info');
            }
        });
    },

    async processIntent(input) {
        console.log(`[AgentOS] Processing Intent: ${input}`);
        // Bridge to Unified AI Orchestrator
        if (window.AI && window.AI.chat) {
            return await window.AI.chat(input);
        }
        return { status: 'unsupported', message: 'AI Orchestrator not loaded' };
    }
};


