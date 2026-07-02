/**
 * SignalMonitor - Tracks WiFi signal strength and triggers events for roaming
 */
const EventEmitter = require('events');

class SignalMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      monitorInterval: config.monitorInterval || 5000,
      threshold: config.signalThreshold || -75,
      ...config,
    };
    this.monitoring = false;
    this.monitorTimer = null;
    this.currentConnection = null;
  }

  async initialize() {
    console.log('[SignalMonitor] Initialized');
  }

  startMonitoring(connection) {
    if (this.monitorTimer) this.stopMonitoring();
    this.currentConnection = connection;
    this.monitoring = true;

    this.monitorTimer = setInterval(async () => {
      try {
        // In a real backend, this would call a system tool or talk to the router
        // simulating a slight signal fluctuation
        if (this.currentConnection) {
          const level = this.currentConnection.level + (Math.random() * 6 - 3);
          if (level < this.config.threshold) {
            this.emit('signal:weak', { ssid: this.currentConnection.ssid, level });
          } else {
            this.emit('signal:check', { ssid: this.currentConnection.ssid, level });
          }
        }
      } catch (error) {
        this.emit('monitor:error', error);
      }
    }, this.config.monitorInterval);
  }

  stopMonitoring() {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.monitoring = false;
    this.currentConnection = null;
    console.log('[SignalMonitor] Stopped monitoring');
  }
}

module.exports = SignalMonitor;
