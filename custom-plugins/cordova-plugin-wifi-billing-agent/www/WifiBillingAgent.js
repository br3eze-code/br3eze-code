/**
 * WiFi Billing Agent - Complete Cordova Plugin Interface
 * Multi-agent WiFi billing system with gossip protocols and AI orchestration
 * @version 4.0.0
 */

var exec = require('cordova/exec');
var Promise = require('cordova-plugin-promise-polyfill').Promise || window.Promise;

/**
 * WiFiBillingAgent - Main plugin class
 */
var WiFiBillingAgent = {
    
    // Version info
    VERSION: '4.0.0',
    AGENT_OS_VERSION: '4.0.0',
    
    // System state
    _initialized: false,
    _agents: {},
    _gossipNode: null,
    _eventListeners: {},
    
    // Configuration defaults
    defaultConfig: {
        // Core settings
        agentId: null, // Auto-generated if not provided
        nodeType: 'mobile', // mobile, hotspot, relay, server
        environment: 'production', // development, staging, production
        
        // WiFi settings. Matching is opt-in so the bridge is domain-neutral.
        preferredNetworks: [],
        networkMatchers: [],
        autoReconnect: true,
        scanInterval: 10000,
        signalThreshold: -75,
        
        // Billing settings
        currency: 'USD',
        defaultRate: 0.10, // per minute
        billingInterval: 60000, // 1 minute
        gracePeriod: 30000, // 30 seconds
        timeLimit: 60, // default 60 minutes
        dataLimit: 1024 * 1024 * 1024, // 1GB default
        
        // Gossip protocol settings
        gossipEnabled: true,
        gossipInterval: 5000,
        fanout: 3,
        meshNetworking: true,
        
        // AI orchestration settings
        aiEnabled: true,
        autonomyLevel: 'assisted', // none, assisted, semi, full
        learningEnabled: true,
        
        // Backend settings. Credentials and endpoints are supplied by the host app.
        apiEndpoint: null,
        apiKey: null,
        tenantId: null,
        siteId: null,
        domain: null,
        agentIdPrefix: 'agentos-agent-',
        firebaseConfig: null,
        
        // Notification settings
        notificationsEnabled: true,
        subtlePrompts: true,
        soundEnabled: true,
        vibrationEnabled: true
    },

    /**
     * Initialize the WiFi Billing Agent system
     * @param {Object} config - Configuration options
     * @returns {Promise<Object>}
     */
    initialize: function(config) {
        var self = this;
        
        return new Promise(function(resolve, reject) {
            if (self._initialized) {
                resolve({ status: 'already_initialized', version: self.VERSION });
                return;
            }

            // Merge configuration
            var finalConfig = Object.assign({}, self.defaultConfig, config);
            
            // Generate agent ID if not provided
            if (!finalConfig.agentId) {
                finalConfig.agentId = self._generateAgentId();
            }

            console.log('[WiFiBillingAgent] Initializing with config:', finalConfig);

            // Initialize native plugin
            exec(
                function(result) {
                    self._initialized = true;
                    self._config = finalConfig;
                    
                    // Initialize JavaScript agents
                    self._initializeAgents(finalConfig);
                    
                    resolve({
                        status: 'initialized',
                        version: self.VERSION,
                        agentId: finalConfig.agentId,
                        platform: result.platform,
                        nativeReady: true
                    });
                },
                function(error) {
                    console.error('[WiFiBillingAgent] Initialization failed:', error);
                    reject(error);
                },
                'WiFiBillingAgent',
                'initialize',
                [finalConfig]
            );
        });
    },

    /**
     * Connect to a WiFi network with billing session
     * @param {string} ssid - Network SSID
     * @param {Object} options - Connection options
     * @returns {Promise<Object>}
     */
    connect: function(ssid, options) {
        var self = this;
        options = options || {};
        
        return new Promise(function(resolve, reject) {
            if (!self._initialized) {
                reject(new Error('WiFiBillingAgent not initialized. Call initialize() first.'));
                return;
            }

            // Check if this is a billing network
            var isBillingNetwork = self._isBillingNetwork(ssid);
            
            var connectOptions = {
                ssid: ssid,
                password: options.password || null,
                algorithm: options.algorithm || 'WPA2',
                isHidden: options.isHidden || false,
                connectionType: options.connectionType || 'auto',
                
                // Billing parameters
                isBillingNetwork: isBillingNetwork,
                userId: options.userId || null,
                planId: options.planId || null,
                sessionId: options.sessionId || null,
                timeLimit: options.timeLimit || self._config.timeLimit,
                dataLimit: options.dataLimit || self._config.dataLimit,
                autoRenew: options.autoRenew || false,
                
                // Advanced options
                timeout: options.timeout || 30000,
                backgroundMode: options.backgroundMode || false
            };

            exec(
                function(result) {
                    // Start JavaScript-side session tracking
                    if (isBillingNetwork && result.sessionId) {
                        self._startBillingSession(result.sessionId, ssid, options);
                    }
                    
                    resolve(result);
                },
                function(error) {
                    reject(error);
                },
                'WiFiBillingAgent',
                'connect',
                [connectOptions]
            );
        });
    },

    /**
     * Disconnect from current network
     * @param {Object} options - Disconnection options
     * @returns {Promise<Object>}
     */
    disconnect: function(options) {
        var self = this;
        options = options || {};
        
        return new Promise(function(resolve, reject) {
            var disconnectOptions = {
                endSession: options.endSession !== false,
                reason: options.reason || 'user_request',
                preserveData: options.preserveData || false
            };

            exec(
                function(result) {
                    // End JavaScript-side session tracking
                    if (result.sessionEnded && result.sessionId) {
                        self._endBillingSession(result.sessionId, options.reason);
                    }
                    
                    resolve(result);
                },
                function(error) {
                    reject(error);
                },
                'WiFiBillingAgent',
                'disconnect',
                [disconnectOptions]
            );
        });
    },

    /**
     * Get current connection information
     * @returns {Promise<Object>}
     */
    getConnectionInfo: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getConnectionInfo', []);
        });
    },

    /**
     * Scan for available networks with billing detection
     * @param {Object} options - Scan options
     * @returns {Promise<Array>}
     */
    scan: function(options) {
        options = options || {};
        
        return new Promise(function(resolve, reject) {
            var scanOptions = {
                timeout: options.timeout || 10000,
                includeHidden: options.includeHidden || false,
                minSignalLevel: options.minSignalLevel || -80,
                onlyBillingNetworks: options.onlyBillingNetworks || false
            };

            exec(
                function(networks) {
                    // Process and classify networks
                    var processed = networks.map(function(n) {
                        return {
                            ssid: n.ssid,
                            bssid: n.bssid,
                            level: n.level,
                            frequency: n.frequency,
                            capabilities: n.capabilities,
                            isBillingNetwork: this._isBillingNetwork(n.ssid),
                            signalQuality: this._calculateSignalQuality(n.level),
                            security: this._parseSecurity(n.capabilities)
                        };
                    }.bind(this));
                    
                    if (scanOptions.onlyBillingNetworks) {
                        processed = processed.filter(function(n) { return n.isBillingNetwork; });
                    }
                    
                    resolve(processed.sort(function(a, b) { return b.level - a.level; }));
                }.bind(this),
                reject,
                'WiFiBillingAgent',
                'scan',
                [scanOptions]
            );
        }.bind(this));
    },

    /**
     * Start a billing session
     * @param {Object} sessionConfig - Session configuration
     * @returns {Promise<Object>}
     */
    startBillingSession: function(sessionConfig) {
        var self = this;
        
        return new Promise(function(resolve, reject) {
            var config = Object.assign({
                currency: self._config.currency,
                rate: self._config.defaultRate,
                billingInterval: self._config.billingInterval
            }, sessionConfig);

            exec(
                function(result) {
                    self._startBillingSession(result.sessionId, result.ssid, config);
                    resolve(result);
                },
                reject,
                'WiFiBillingAgent',
                'startBillingSession',
                [config]
            );
        });
    },

    /**
     * Get current billing session status
     * @returns {Promise<Object>}
     */
    getSessionStatus: function() {
        return new Promise(function(resolve, reject) {
            exec(
                function(status) {
                    resolve({
                        active: status.active,
                        sessionId: status.sessionId,
                        state: status.state, // active, paused, expired
                        ssid: status.ssid,
                        startTime: status.startTime,
                        elapsedMinutes: status.elapsedMinutes,
                        remainingMinutes: status.remainingMinutes,
                        dataUsed: status.dataUsed,
                        dataUsedMB: status.dataUsedMB,
                        dataLimitMB: status.dataLimitMB,
                        currentCost: status.currentCost,
                        totalCost: status.totalCost,
                        currency: status.currency
                    });
                },
                reject,
                'WiFiBillingAgent',
                'getSessionStatus',
                []
            );
        });
    },

    /**
     * Pause current billing session
     * @param {string} reason - Reason for pausing
     * @returns {Promise<Object>}
     */
    pauseSession: function(reason) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'pauseSession', [reason || 'user_request']);
        });
    },

    /**
     * Resume billing session
     * @returns {Promise<Object>}
     */
    resumeSession: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'resumeSession', []);
        });
    },

    /**
     * Get data usage statistics
     * @returns {Promise<Object>}
     */
    getDataUsage: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getDataUsage', []);
        });
    },

    /**
     * Enable automatic reconnection
     * @param {Object} config - Reconnection configuration
     * @returns {Promise<Object>}
     */
    enableAutoReconnect: function(config) {
        config = config || {};
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'enableAutoReconnect', [{
                preferredNetworks: config.preferredNetworks || [],
                retryInterval: config.retryInterval || 5000,
                maxRetries: config.maxRetries || 10,
                roamingEnabled: config.roamingEnabled !== false
            }]);
        });
    },

    /**
     * Disable automatic reconnection
     * @returns {Promise<Object>}
     */
    disableAutoReconnect: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'disableAutoReconnect', []);
        });
    },

    /**
     * Gossip Protocol: Get peer information
     * @returns {Promise<Object>}
     */
    getGossipPeers: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'getGossipPeers', []);
        });
    },

    /**
     * Gossip Protocol: Broadcast message to peers
     * @param {string} type - Message type
     * @param {Object} payload - Message payload
     * @returns {Promise<Object>}
     */
    gossipBroadcast: function(type, payload) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'gossipBroadcast', [type, payload]);
        });
    },

    /**
     * Gossip Protocol: Sync billing state with peers
     * @returns {Promise<Object>}
     */
    syncBillingState: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'syncBillingState', []);
        });
    },

    /**
     * AI Orchestration: Process natural language intent
     * @param {string} input - Natural language input
     * @param {Object} context - Context information
     * @returns {Promise<Object>}
     */
    processIntent: function(input, context) {
        return new Promise(function(resolve, reject) {
            exec(
                function(result) {
                    resolve({
                        intent: result.intent,
                        confidence: result.confidence,
                        actions: result.actions,
                        requiresConfirmation: result.requiresConfirmation,
                        autonomyLevel: result.autonomyLevel
                    });
                },
                reject,
                'WiFiBillingAgent',
                'processIntent',
                [input, context || {}]
            );
        });
    },

    /**
     * AI Orchestration: Execute autonomous action
     * @param {string} actionId - Action identifier
     * @param {Object} params - Action parameters
     * @returns {Promise<Object>}
     */
    executeAutonomousAction: function(actionId, params) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'executeAutonomousAction', [actionId, params || {}]);
        });
    },

    /**
     * Authentication: Login user
     * @param {Object} credentials - User credentials
     * @returns {Promise<Object>}
     */
    authenticate: function(credentials) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'authenticate', [credentials]);
        });
    },

    /**
     * Authentication: Validate session token
     * @param {string} token - Session token
     * @returns {Promise<Object>}
     */
    validateToken: function(token) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'validateToken', [token]);
        });
    },

    /**
     * Authentication: Refresh token
     * @returns {Promise<Object>}
     */
    refreshToken: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'refreshToken', []);
        });
    },

    /**
     * Notifications: Send local notification
     * @param {Object} notification - Notification content
     * @returns {Promise<Object>}
     */
    sendNotification: function(notification) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'sendNotification', [{
                id: notification.id || Date.now(),
                title: notification.title,
                message: notification.message,
                priority: notification.priority || 'normal', // low, normal, high, critical
                actions: notification.actions || [],
                data: notification.data || {}
            }]);
        });
    },

    /**
     * Notifications: Clear notification
     * @param {number} id - Notification ID
     * @returns {Promise<Object>}
     */
    clearNotification: function(id) {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'clearNotification', [id]);
        });
    },

    /**
     * Background Mode: Enable persistent operation
     * @param {Object} config - Background configuration
     * @returns {Promise<Object>}
     */
    enableBackgroundMode: function(config) {
        config = config || {};
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'enableBackgroundMode', [{
                title: config.title || 'WiFi Billing Active',
                text: config.text || 'Monitoring your connection...',
                icon: config.icon || 'ic_notification',
                silent: config.silent || false
            }]);
        });
    },

    /**
     * Background Mode: Disable persistent operation
     * @returns {Promise<Object>}
     */
    disableBackgroundMode: function() {
        return new Promise(function(resolve, reject) {
            exec(resolve, reject, 'WiFiBillingAgent', 'disableBackgroundMode', []);
        });
    },

    /**
     * Get complete system status
     * @returns {Promise<Object>}
     */
    getSystemStatus: function() {
        return new Promise(function(resolve, reject) {
            exec(
                function(status) {
                    resolve({
                        initialized: this._initialized,
                        version: this.VERSION,
                        agentId: this._config?.agentId,
                        platform: status.platform,
                        nativeAgents: status.agents,
                        gossip: status.gossip,
                        currentConnection: status.connection,
                        activeSession: status.session,
                        permissions: status.permissions
                    });
                }.bind(this),
                reject,
                'WiFiBillingAgent',
                'getSystemStatus',
                []
            );
        }.bind(this));
    },

    /**
     * Event subscription
     */
    on: function(event, callback) {
        if (!this._eventListeners[event]) {
            this._eventListeners[event] = [];
        }
        this._eventListeners[event].push(callback);
        
        // Setup native event bridge if first listener
        if (this._eventListeners[event].length === 1) {
            this._setupNativeEventBridge(event);
        }
        
        return function() {
            this.off(event, callback);
        }.bind(this);
    },

    off: function(event, callback) {
        if (!this._eventListeners[event]) return;
        var idx = this._eventListeners[event].indexOf(callback);
        if (idx > -1) {
            this._eventListeners[event].splice(idx, 1);
        }
    },

    _emit: function(event, data) {
        var listeners = this._eventListeners[event] || [];
        listeners.forEach(function(fn) {
            try {
                fn(data);
            } catch (e) {
                console.error('[WiFiBillingAgent] Event handler error:', e);
            }
        });
    },

    _setupNativeEventBridge: function(event) {
        var self = this;
        exec(
            function(data) {
                self._emit(event, data);
            },
            function(error) {
                console.error('[WiFiBillingAgent] Event bridge error:', error);
            },
            'WiFiBillingAgent',
            'subscribeToEvent',
            [event]
        );
    },

    /**
     * Internal: Initialize JavaScript agents
     */
    _initializeAgents: function(config) {
        // Load agent classes (they're loaded via js-module tags)
        var CoreAgent = require('./agents/CoreAgent');
        var WiFiAgent = require('./agents/WiFiAgent');
        var BillingAgent = require('./agents/BillingAgent');
        var AuthAgent = require('./agents/AuthAgent');
        var NotificationAgent = require('./agents/NotificationAgent');
        var AIOrchestrator = require('./agents/AIOrchestrator');
        var GossipNode = require('./protocols/GossipNode');

        // Create core agent
        this._agents.core = CoreAgent;
        this._agents.core.initialize({
            agentId: config.agentId,
            nodeType: config.nodeType
        });

        // Create specialized agents
        this._agents.wifi = new WiFiAgent({
            scanInterval: config.scanInterval,
            autoReconnect: config.autoReconnect,
            preferredNetworks: config.preferredNetworks
        });

        this._agents.billing = new BillingAgent({
            currency: config.currency,
            defaultRate: config.defaultRate,
            billingInterval: config.billingInterval
        });

        this._agents.auth = new AuthAgent({
            apiEndpoint: config.apiEndpoint,
            apiKey: config.apiKey
        });

        this._agents.notification = new NotificationAgent({
            subtlePrompts: config.subtlePrompts,
            soundEnabled: config.soundEnabled,
            vibrationEnabled: config.vibrationEnabled
        });

        if (config.aiEnabled) {
            this._agents.ai = new AIOrchestrator({
                autonomyLevel: config.autonomyLevel,
                learningEnabled: config.learningEnabled
            });
        }

        // Initialize gossip protocol
        if (config.gossipEnabled) {
            this._gossipNode = new GossipNode({
                nodeId: config.agentId,
                gossipInterval: config.gossipInterval,
                fanout: config.fanout
            });
        }

        console.log('[WiFiBillingAgent] JavaScript agents initialized');
    },

    /**
     * Internal: Start billing session tracking
     */
    _startBillingSession: function(sessionId, ssid, config) {
        if (this._agents.billing) {
            var sessionConfig = Object.assign({
                id: sessionId,
                ssid: ssid
            }, config);
            this._agents.billing.startSession(sessionConfig);
        }
    },

    /**
     * Internal: End billing session tracking
     */
    _endBillingSession: function(sessionId, reason) {
        if (this._agents.billing) {
            this._agents.billing.endSession(sessionId, reason);
        }
    },

    /**
     * Internal: Check if SSID is a billing network
     */
    _isBillingNetwork: function(ssid) {
        if (!ssid) return false;
        var config = this._config || this.defaultConfig;
        var patterns = config.networkMatchers || config.preferredNetworks || [];
        return patterns.some(function(pattern) {
            if (pattern && typeof pattern.test === 'function') return pattern.test(ssid);
            if (typeof pattern === 'function') return Boolean(pattern(ssid));
            return typeof pattern === 'string' && pattern.length > 0 && ssid.indexOf(pattern) !== -1;
        });
    },

    /**
     * Internal: Calculate signal quality
     */
    _calculateSignalQuality: function(level) {
        if (level >= -50) return 'excellent';
        if (level >= -60) return 'good';
        if (level >= -70) return 'fair';
        return 'poor';
    },

    /**
     * Internal: Parse security from capabilities
     */
    _parseSecurity: function(capabilities) {
        if (!capabilities) return 'unknown';
        if (capabilities.indexOf('WPA3') !== -1) return 'WPA3';
        if (capabilities.indexOf('WPA2') !== -1) return 'WPA2';
        if (capabilities.indexOf('WPA') !== -1) return 'WPA';
        if (capabilities.indexOf('WEP') !== -1) return 'WEP';
        return 'Open';
    },

    /**
     * Internal: Generate unique agent ID
     */
    _generateAgentId: function() {
        var config = this._config || this.defaultConfig;
        var prefix = config.agentIdPrefix || 'agentos-agent-';
        return prefix + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    },

    /**
     * Shutdown the agent system
     * @returns {Promise<Object>}
     */
    shutdown: function() {
        var self = this;
        
        return new Promise(function(resolve, reject) {
            exec(
                function(result) {
                    self._initialized = false;
                    self._agents = {};
                    self._gossipNode = null;
                    resolve(result);
                },
                reject,
                'WiFiBillingAgent',
                'shutdown',
                []
            );
        });
    }
};

export default WiFiBillingAgent;