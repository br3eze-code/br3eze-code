/**
 * Web Platform Adapter
 * Uses Web APIs for WiFi management where available
 */

var WebPlatform = {
    
    _initialized: false,
    _peerConnection: null,
    _dataChannel: null,
    
    initialize: function(config) {
        var self = this;
        
        return new Promise(function(resolve) {
            console.log('[WebPlatform] Initializing');
            
            // Check available APIs
            self._checkAPIs();
            
            // Setup WebRTC for gossip protocol
            self._setupWebRTC();
            
            self._initialized = true;
            
            resolve({
                platform: 'web',
                apis: self._availableAPIs
            });
        });
    },
    
    _availableAPIs: {},
    
    _checkAPIs: function() {
        this._availableAPIs = {
            bluetooth: !!navigator.bluetooth,
            usb: !!navigator.usb,
            serial: !!navigator.serial,
            network: !!navigator.connection,
            geolocation: !!navigator.geolocation,
            online: navigator.onLine
        };
        
        console.log('[WebPlatform] Available APIs:', this._availableAPIs);
    },
    
    _setupWebRTC: function() {
        var self = this;
        
        // Setup WebRTC for peer-to-peer communication
        var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        
        if (RTCPeerConnection) {
            this._peerConnection = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
            });
            
            this._dataChannel = this._peerConnection.createDataChannel('gossip', {
                ordered: true
            });
            
            this._dataChannel.onopen = function() {
                console.log('[WebPlatform] WebRTC data channel open');
            };
            
            this._dataChannel.onmessage = function(event) {
                console.log('[WebPlatform] Received:', event.data);
                self._handleGossipMessage(JSON.parse(event.data));
            };
        }
    },
    
    _handleGossipMessage: function(message) {
        // Handle gossip protocol messages
        console.log('[WebPlatform] Gossip message:', message);
    },
    
    /**
     * Web-based WiFi connection
     * Uses available APIs or guides user
     */
    connect: function(options) {
        return new Promise(function(resolve, reject) {
            var ssid = options.ssid;
            var password = options.password;
            
            console.log('[WebPlatform] Connect to:', ssid);
            
            // Try Web Bluetooth for smart configuration
            if (navigator.bluetooth) {
                WebPlatform._tryBluetoothConfig(ssid, password)
                    .then(resolve)
                    .catch(function() {
                        // Fallback to manual
                        WebPlatform._manualConfig(ssid, password)
                            .then(resolve)
                            .catch(reject);
                    });
            } else {
                // Manual configuration
                WebPlatform._manualConfig(ssid, password)
                    .then(resolve)
                    .catch(reject);
            }
        });
    },
    
    _tryBluetoothConfig: function(ssid, password) {
        return new Promise(function(resolve, reject) {
            navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: ['wifi_config_service_uuid']
            })
            .then(function(device) {
                console.log('[WebPlatform] Bluetooth device:', device.name);
                return device.gatt.connect();
            })
            .then(function(server) {
                resolve({
                    success: true,
                    method: 'web_bluetooth',
                    message: 'Connected via Bluetooth LE'
                });
            })
            .catch(reject);
        });
    },
    
    _manualConfig: function(ssid, password) {
        return new Promise(function(resolve) {
            // Generate QR code or show instructions
            resolve({
                success: true,
                method: 'manual',
                message: 'Please connect manually to ' + ssid,
                instructions: {
                    ssid: ssid,
                    password: password,
                    qrCode: WebPlatform._generateQR(ssid, password)
                }
            });
        });
    },
    
    _generateQR: function(ssid, password) {
        // Generate WiFi QR code data
        return 'WIFI:T:WPA;S:' + ssid + ';P:' + password + ';;';
    },
    
    /**
     * Get connection info using Network Information API
     */
    getConnectionInfo: function() {
        return new Promise(function(resolve) {
            var info = {
                platform: 'web',
                online: navigator.onLine,
                type: 'unknown'
            };
            
            if (navigator.connection) {
                info.type = navigator.connection.effectiveType || 'unknown';
                info.downlink = navigator.connection.downlink;
                info.rtt = navigator.connection.rtt;
            }
            
            resolve(info);
        });
    },
    
    /**
     * Web-based peer sync using WebRTC
     */
    syncPeers: function() {
        var self = this;
        
        return new Promise(function(resolve) {
            if (!self._dataChannel || self._dataChannel.readyState !== 'open') {
                resolve({
                    peers: 0,
                    status: 'no_connection'
                });
                return;
            }
            
            // Send sync request
            self._dataChannel.send(JSON.stringify({
                type: 'sync_request',
                timestamp: Date.now()
            }));
            
            resolve({
                peers: 1,
                status: 'connected',
                method: 'webrtc'
            });
        });
    },
    
    /**
     * Start billing session (web-based tracking)
     */
    startBillingSession: function(config) {
        return new Promise(function(resolve) {
            // Use Performance API for timing
            var session = {
                id: 'web-sess-' + Date.now(),
                startTime: performance.now(),
                platform: 'web'
            };
            
            // Store in localStorage
            localStorage.setItem('wba_session', JSON.stringify(session));
            
            resolve({
                success: true,
                session: session
            });
        });
    },
    
    /**
     * Get session status
     */
    getSessionStatus: function() {
        return new Promise(function(resolve) {
            var sessionData = localStorage.getItem('wba_session');
            
            if (!sessionData) {
                resolve({ active: false });
                return;
            }
            
            var session = JSON.parse(sessionData);
            var elapsed = (performance.now() - session.startTime) / 1000 / 60; // minutes
            
            resolve({
                active: true,
                elapsedMinutes: elapsed,
                platform: 'web'
            });
        });
    }
};

export default WebPlatform;