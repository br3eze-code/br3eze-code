/**
 * ConnectionManager - Handles WiFi connections with platform abstraction
 */

class ConnectionManager {
  constructor(config) {
    this.config = config;
    this.platform = this.detectPlatform();
    this.native = null; // Cordova plugin reference
    this.currentConnection = null;
    this.callbacks = {};
  }

  on(event, handler) {
    this.callbacks[event] = this.callbacks[event] || [];
    this.callbacks[event].push(handler);
  }

  emit(event, data) {
    if (this.callbacks[event]) {
      this.callbacks[event].forEach(h => h(data));
    }
  }

  detectPlatform() {
    if (typeof cordova !== 'undefined') {
      return cordova.platformId; // 'android', 'ios', etc.
    }
    if (typeof window !== 'undefined' && window.process && window.process.type === 'renderer') {
      return 'electron';
    }
    if (typeof window !== 'undefined' && window.navigator) {
      return 'web';
    }
    return 'node';
  }

  async initialize() {
    if (this.platform === 'android' || this.platform === 'ios') {
      // Wait for Cordova plugins
      await this.waitForPlugins();
      this.native = window.PowerConnectWiFi || window.WifiWizard2;
    }
  }

  waitForPlugins() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
    return new Promise(resolve => {
      if (window.PowerConnectWiFi || window.WifiWizard2) {
        resolve();
      } else {
        document.addEventListener('deviceready', resolve, { once: true });
      }
    });
  }

  async connect(options) {
    const { ssid, password, algorithm, isHidden, billingSession, timeout } = options;

    // Pre-connection checks
    await this.preConnectionChecks();

    let connectionResult;

    if (this.native) {
      connectionResult = await this.native.connect(ssid, {
        password,
        algorithm,
        isHidden,
        sessionId: billingSession?.id,
        planId: billingSession?.planId,
        connectionType: this.getConnectionType(),
      });
    } else {
      // Web/Node fallback - simulate or use alternative
      connectionResult = await this.simulateConnection(options);
    }

    if (connectionResult.success) {
      this.currentConnection = {
        ssid,
        connectedAt: Date.now(),
        billingSession,
        ...connectionResult,
      };

      this.emit('connected', this.currentConnection);

      // Start keepalive
      this.startKeepalive();
    }

    return connectionResult;
  }

  async disconnect() {
    if (!this.currentConnection) return;

    if (this.native) {
      await this.native.disconnect(this.currentConnection.ssid, false);
    }

    this.emit('disconnected', {
      ssid: this.currentConnection.ssid,
      duration: Date.now() - this.currentConnection.connectedAt,
      reason: 'user_initiated',
    });

    this.currentConnection = null;
    this.stopKeepalive();
  }

  async prepareHandoff() {
    // Prepare for seamless roaming
    this.stopKeepalive();
    // Keep connection alive but ready to switch
  }

  startKeepalive() {
    this.keepaliveInterval = setInterval(async () => {
      try {
        const info = await this.native?.getConnectionInfo();
        if (!info || !info.connected) {
          this.emit('connection_lost', { expected: true });
          this.handleUnexpectedDisconnect();
        }
      } catch (error) {
        this.emit('keepalive_error', error);
      }
    }, 10000);
  }

  stopKeepalive() {
    clearInterval(this.keepaliveInterval);
  }

  handleUnexpectedDisconnect() {
    this.stopKeepalive();
    this.currentConnection = null;

    if (this.config.autoReconnect) {
      this.emit('reconnecting', { ssid: this.currentConnection?.ssid });
      // Attempt reconnection
    }
  }

  async preConnectionChecks() {
    // Check permissions
    const permissions = await this.native?.checkPermissions();
    if (permissions && !permissions.wifi) {
      await this.native?.requestPermissions();
    }

    // Check if already connected
    const current = await this.native?.getConnectionInfo();
    if (current?.connected && current.ssid === this.currentConnection?.ssid) {
      throw new Error('Already connected to this network');
    }
  }

  getConnectionType() {
    // Determine best connection method based on Android version
    if (this.platform === 'android') {
      // Guard 'device' global which is a Cordova plugin
      const version = typeof device !== 'undefined' ? device.version : null;
      if (version && parseInt(version) >= 10) {
        return 'suggested'; // Android 10+ suggestion API
      }
    }
    return 'direct';
  }

  async simulateConnection(options) {
    // Fallback for testing/development
    console.log('[ConnectionManager] Simulating connection to', options.ssid);
    await new Promise(r => setTimeout(r, 1000));
    return {
      success: true,
      method: 'simulated',
      ssid: options.ssid,
    };
  }
}

module.exports = ConnectionManager;
