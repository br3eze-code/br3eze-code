/**
 * WiFi Agent - Manages WiFi connections with billing integration
 */

const ConnectionManager = require('./ConnectionManager');
const NetworkScanner = require('./NetworkScanner');
const SignalMonitor = require('./SignalMonitor');
const EventEmitter = require('events');

class WiFiAgent extends EventEmitter {
    constructor(config = {}) {
        super();
        this.config = {
            scanInterval: config.scanInterval || 10000,
            signalThreshold: config.signalThreshold || -75,
            autoReconnect: config.autoReconnect !== false,
            preferredNetworks: config.preferredNetworks || [],
            ...config
        };

        this.id = `wifi-agent-${Date.now()}`;
        this.state = 'initialized';
        this.connectionManager = new ConnectionManager(this.config);
        this.networkScanner = new NetworkScanner(this.config);
        this.signalMonitor = new SignalMonitor(this.config);
        
        this.currentConnection = null;
        this.connectionHistory = [];
    }

    async initialize() {
        await this.connectionManager.initialize();
        await this.networkScanner.initialize();
        await this.signalMonitor.initialize();
        
        this.setupEventListeners();
        this.state = 'ready';
    }

    setupEventListeners() {
        // Connection events
        this.connectionManager.on('connected', (data) => {
            this.currentConnection = data;
            this.emit('wifi:connected', data);
            this.core?.emit('wifi:connected', data);
        });

        this.connectionManager.on('disconnected', (data) => {
            this.connectionHistory.push({
                ...this.currentConnection,
                disconnectedAt: Date.now(),
                reason: data.reason
            });
            this.currentConnection = null;
            this.emit('wifi:disconnected', data);
        });

        // Signal monitoring
        this.signalMonitor.on('signal:weak', (data) => {
            this.emit('wifi:signal_weak', data);
            if (this.config.autoReconnect) {
                this.attemptRoam();
            }
        });

        // Network discovery
        this.networkScanner.on('network:discovered', (network) => {
            if (this.isBillingNetwork(network)) {
                this.emit('wifi:billing_network_found', network);
            }
        });
    }

    async connect(options) {
        const {
            ssid,
            password,
            algorithm = 'WPA2',
            isHidden = false,
            billingSession = null,
            timeout = 30000
        } = options;

        // Validate billing session if provided
        if (billingSession) {
            const valid = await this.validateBillingSession(billingSession);
            if (!valid) {
                throw new Error('Invalid or expired billing session');
            }
        }

        // Attempt connection
        const connection = await this.connectionManager.connect({
            ssid,
            password,
            algorithm,
            isHidden,
            billingSession,
            timeout
        });

        // Start monitoring
        this.signalMonitor.startMonitoring(connection);

        return connection;
    }

    async disconnect(options = {}) {
        const { endBillingSession = false, reason = 'user_initiated' } = options;

        if (this.currentConnection?.billingSession && endBillingSession) {
            await this.core?.dispatchTask('billing:end_session', {
                sessionId: this.currentConnection.billingSession.id,
                reason
            });
        }

        await this.connectionManager.disconnect();
        this.signalMonitor.stopMonitoring();
    }

    async scan(options = {}) {
        const networks = await this.networkScanner.scan({
            includeHidden: options.includeHidden || false,
            minSignalLevel: options.minSignalLevel || -80,
            timeout: options.timeout || 10000
        });

        // Filter and sort billing networks
        return networks
            .map(n => ({
                ...n,
                isBillingNetwork: this.isBillingNetwork(n),
                signalQuality: this.calculateSignalQuality(n.level)
            }))
            .sort((a, b) => b.level - a.level);
    }

    isBillingNetwork(network) {
        // Check if SSID matches billing network patterns
        const patterns = [
            /^PC-/i,           // Power Connect prefix
            /PowerConnect/i,    // Full name
            /Billing-WiFi/i,    // Generic billing
            /\[PC\]/,           // Bracket notation
        ];
        
        return patterns.some(p => p.test(network.ssid));
    }

    calculateSignalQuality(level) {
        if (level >= -50) return 'excellent';
        if (level >= -60) return 'good';
        if (level >= -70) return 'fair';
        return 'poor';
    }

    async attemptRoam() {
        if (!this.currentConnection) return;

        const available = await this.scan({ minSignalLevel: -65 });
        const currentSsid = this.currentConnection.ssid;

        // Find better network (same SSID stronger signal, or preferred billing network)
        const betterNetwork = available.find(n => 
            (n.ssid === currentSsid && n.level > this.currentConnection.level + 10) ||
            (n.isBillingNetwork && n.ssid !== currentSsid && n.level > -60)
        );

        if (betterNetwork) {
            this.emit('wifi:roaming', { from: currentSsid, to: betterNetwork.ssid });
            
            // Graceful handoff
            await this.connectionManager.prepareHandoff();
            await this.connect({
                ssid: betterNetwork.ssid,
                password: this.currentConnection.password,
                billingSession: this.currentConnection.billingSession
            });
        }
    }

    async validateBillingSession(session) {
        // Check with billing agent
        const billingAgent = this.core?.agents.get('billing');
        if (!billingAgent) return false;

        const status = await billingAgent.getSessionStatus(session.id);
        return status.active && status.remainingMinutes > 0;
    }

    getCurrentConnection() {
        return this.currentConnection;
    }

    getConnectionHistory() {
        return this.connectionHistory;
    }

    on(event, handler) {
        // Event subscription
        this.events = this.events || {};
        this.events[event] = this.events[event] || [];
        this.events[event].push(handler);
        return () => {
            const idx = this.events[event].indexOf(handler);
            if (idx > -1) this.events[event].splice(idx, 1);
        };
    }

    emit(event, data) {
        if (this.events?.[event]) {
            this.events[event].forEach(h => h(data));
        }
    }

    async activate() {
        this.state = 'active';
        this.networkScanner.startPeriodicScan();
    }

    async deactivate() {
        this.state = 'inactive';
        await this.disconnect({ reason: 'agent_deactivation' });
        this.networkScanner.stopPeriodicScan();
    }
}

module.exports = WiFiAgent;