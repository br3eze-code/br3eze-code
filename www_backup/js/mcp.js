// ============================================================
// CORDOVA PLUGIN BRIDGE - MCP CLIENT
// Connects native device APIs to Agent OS MCP Server
// ============================================================

class CordovaMCPBridge {
    constructor() {
        this.platform = this.detectPlatform();
        this.deviceReady = false;
        this.pendingCommands = [];

        document.addEventListener('deviceready', () => {
            this.deviceReady = true;
            this.flushPendingCommands();
        }, false);
    }

    detectPlatform() {
        if (window.cordova) {
            const platform = cordova.platformId;
            if (platform === 'android') return 'android';
            if (platform === 'ios') return 'ios';
            return 'cordova-' + platform;
        }
        if (window.process && window.process.type === 'renderer') return 'electron';
        return 'web';
    }

    // WiFi Control - Platform Abstraction
    async scanWiFi(duration = 10000) {
        if (this.platform === 'android') {
            return this.androidScanWiFi(duration);
        } else if (this.platform === 'ios') {
            return this.iosScanWiFi(duration);
        } else if (this.platform === 'electron') {
            return this.electronScanWiFi(duration);
        }
        throw new Error(`WiFi scan not supported on ${this.platform}`);
    }

    // Android: WiFiWizard2
    async androidScanWiFi(duration) {
        return new Promise((resolve, reject) => {
            if (!window.WifiWizard2) {
                reject(new Error('WiFiWizard2 plugin not available'));
                return;
            }

            WifiWizard2.scan(duration)
                .then(networks => {
                    resolve({
                        platform: 'android',
                        networks: networks.map(n => ({
                            ssid: n.SSID,
                            bssid: n.BSSID,
                            level: n.level,
                            frequency: n.frequency,
                            capabilities: n.capabilities,
                            timestamp: Date.now()
                        }))
                    });
                })
                .catch(reject);
        });
    }

    // iOS: NEHotspotConfigurationManager
    async iosScanWiFi(duration) {
        return new Promise((resolve, reject) => {
            if (!window.hotspot) {
                reject(new Error('iOS Hotspot plugin not available'));
                return;
            }

            // iOS doesn't allow true WiFi scanning, use NEHotspotConfiguration
            hotspot.getConfiguredNetworks(
                (networks) => {
                    resolve({
                        platform: 'ios',
                        networks: networks.map(n => ({
                            ssid: n.SSID,
                            bssid: n.BSSID || 'unknown',
                            level: n.signalStrength || 0,
                            isSecure: n.isSecure,
                            timestamp: Date.now()
                        }))
                    });
                },
                (error) => reject(new Error(`iOS scan failed: ${error}`))
            );
        });
    }

    // Electron: node-wifi
    async electronScanWiFi(duration) {
        // In Electron main process, use node-wifi
        if (window.require) {
            const wifi = window.require('node-wifi');
            wifi.init({ iface: null });

            const networks = await wifi.scan();
            return {
                platform: 'electron',
                networks: networks.map(n => ({
                    ssid: n.ssid,
                    bssid: n.mac,
                    level: n.signal_level,
                    frequency: n.frequency,
                    security: n.security,
                    timestamp: Date.now()
                }))
            };
        }
        throw new Error('Electron WiFi requires node-wifi in main process');
    }

    // Connect to WiFi - Platform Specific
    async connectWiFi(config) {
        const { ssid, password, security, platform } = config;

        if (platform === 'android') {
            return this.androidConnectWiFi(ssid, password, security);
        } else if (platform === 'ios') {
            return this.iosConnectWiFi(ssid, password);
        } else if (platform === 'legacy') {
            return this.legacyConnectWiFi(config);
        }
    }

    // Disconnect WiFi - Platform Abstraction
    async disconnectWiFi(platformName) {
        const targetPlatform = platformName || this.platform;
        if (targetPlatform === 'android') {
            return new Promise((resolve, reject) => {
                if (!window.WifiWizard2) {
                    reject(new Error('WifiWizard2 plugin not available'));
                    return;
                }
                WifiWizard2.disconnect()
                    .then(() => resolve({ success: true, platform: 'android', timestamp: Date.now() }))
                    .catch(reject);
            });
        } else if (targetPlatform === 'ios') {
            return new Promise((resolve, reject) => {
                if (!window.hotspot) {
                    reject(new Error('iOS Hotspot plugin not available'));
                    return;
                }
                hotspot.disconnect(
                    () => resolve({ success: true, platform: 'ios', timestamp: Date.now() }),
                    (error) => reject(new Error(`iOS disconnect failed: ${error}`))
                );
            });
        }
        return { success: true, platform: targetPlatform, message: 'WiFi disconnect simulated' };
    }

    async androidConnectWiFi(ssid, password, security) {
        return new Promise((resolve, reject) => {
            if (!window.WifiWizard2) {
                reject(new Error('WiFiWizard2 not available'));
                return;
            }

            // Connect and bind to network
            WifiWizard2.connect(ssid, true, password, 'WPA')
                .then(() => WifiWizard2.getConnectedSSID())
                .then(connectedSsid => {
                    resolve({
                        success: true,
                        ssid: connectedSsid,
                        platform: 'android',
                        timestamp: Date.now()
                    });
                })
                .catch(reject);
        });
    }

    async iosConnectWiFi(ssid, password) {
        return new Promise((resolve, reject) => {
            if (!window.hotspot) {
                reject(new Error('iOS Hotspot plugin not available'));
                return;
            }

            // NEHotspotConfiguration for iOS 11+
            const config = {
                SSID: ssid,
                passphrase: password,
                isWEP: false
            };

            hotspot.connectToProtectedNetwork(
                config,
                () => {
                    resolve({
                        success: true,
                        ssid: ssid,
                        platform: 'ios',
                        timestamp: Date.now()
                    });
                },
                (error) => reject(new Error(`iOS connection failed: ${error}`))
            );
        });
    }

    // Legacy devices: IM10, RediF15, etc.
    async legacyConnectWiFi(config) {
        const { ssid, password, deviceType, endpoint } = config;

        // Legacy devices often use HTTP API or serial commands
        if (deviceType === 'IM10') {
            return this.im10Connect(endpoint, ssid, password);
        } else if (deviceType === 'RediF15') {
            return this.rediF15Connect(endpoint, ssid, password);
        }

        throw new Error(`Unknown legacy device type: ${deviceType}`);
    }

    async im10Connect(endpoint, ssid, password) {
        // IM10 uses HTTP API for WiFi configuration
        const response = await fetch(`http://${endpoint}/api/wifi/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ssid, password, security: 'WPA2' })
        });

        if (!response.ok) throw new Error(`IM10 connection failed: ${response.status}`);
        return await response.json();
    }

    async rediF15Connect(endpoint, ssid, password) {
        // RediF15 uses Modbus or custom serial protocol
        // This would interface with a native plugin or serial bridge
        return new Promise((resolve, reject) => {
            if (!window.Serial) {
                reject(new Error('Serial plugin not available for RediF15'));
                return;
            }

            // Send serial command to configure WiFi
            const command = `WIFI:${ssid}:${password}\n`;
            Serial.write(
                endpoint, // port
                command,
                () => resolve({ success: true, device: 'RediF15', timestamp: Date.now() }),
                (error) => reject(new Error(`RediF15 serial error: ${error}`))
            );
        });
    }

    // MikroTik RouterOS API
    async mikrotikCommand(host, username, password, command, params = {}) {
        // Use MikroTik API via HTTP or native plugin
        const apiUrl = `http://${host}/rest/${command}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + btoa(`${username}:${password}`),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        if (!response.ok) throw new Error(`MikroTik API error: ${response.status}`);
        return await response.json();
    }

    // CHAP-MD5 Hotspot Authentication
    async mikrotikHotspotLogin(host, username, password, challenge) {
        // Generate CHAP-MD5 response
        const md5 = await this.calculateCHAPMD5(password, challenge);

        const formData = new FormData();
        formData.append('username', username);
        formData.append('password', ''); // CHAP doesn't send plain password
        formData.append(' chap-id', '1');
        formData.append(' chap-challenge', challenge);
        formData.append(' response', md5);

        const response = await fetch(`http://${host}/login`, {
            method: 'POST',
            body: formData
        });

        return {
            success: response.ok,
            authenticated: response.url.includes('status'),
            timestamp: Date.now()
        };
    }

    async calculateCHAPMD5(password, challenge) {
        // Use js-md5 or crypto API
        if (window.md5) {
            return window.md5.md5('1' + password + this.hexToBytes(challenge));
        }

        // Fallback using Web Crypto
        const encoder = new TextEncoder();
        const data = encoder.encode('1' + password + this.hexToBytes(challenge));
        const hashBuffer = await crypto.subtle.digest('MD5', data);
        return this.bufferToHex(hashBuffer);
    }

    hexToBytes(hex) {
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.substr(i, 2), 16));
        }
        return String.fromCharCode.apply(null, bytes);
    }

    bufferToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    // Federated Sync - Gossip Protocol
    async federatedSync(nodeId, data, priority = 'normal') {
        // Post to Agent OS gateway
        const response = await fetch('/api/v1/federated/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId, data, priority, timestamp: Date.now() })
        });

        return await response.json();
    }

    // Device Telemetry
    async getDeviceTelemetry(deviceId, metrics = []) {
        const response = await fetch(`/api/v1/devices/${deviceId}/telemetry?metrics=${metrics.join(',')}`);
        return await response.json();
    }

    // Flush pending commands after device ready
    flushPendingCommands() {
        while (this.pendingCommands.length > 0) {
            const cmd = this.pendingCommands.shift();
            this.executeCommand(cmd.name, cmd.args)
                .then(cmd.resolve)
                .catch(cmd.reject);
        }
    }

    // Queue command if device not ready
    queueCommand(name, args) {
        return new Promise((resolve, reject) => {
            this.pendingCommands.push({ name, args, resolve, reject });
        });
    }

    // Main execute method
    async executeCommand(name, args) {
        if (!this.deviceReady) {
            return this.queueCommand(name, args);
        }

        switch (name) {
            case 'scan_wifi':
                return this.scanWiFi(args.duration);
            case 'connect_wifi':
                return this.connectWiFi(args);
            case 'disconnect_wifi':
                return this.disconnectWiFi(args.platform);
            case 'mikrotik_command':
                return this.mikrotikCommand(args.host, args.username, args.password, args.command, args.params);
            case 'mikrotik_hotspot_login':
                return this.mikrotikHotspotLogin(args.host, args.username, args.password, args.challenge);
            case 'legacy_control':
                return this.legacyConnectWiFi(args);
            case 'federated_sync':
                return this.federatedSync(args.nodeId, args.data, args.priority);
            default:
                throw new Error(`Unknown command: ${name}`);
        }
    }
}

// Export for Cordova
window.CordovaMCPBridge = CordovaMCPBridge;