import eventBus from './eventBus.js';
import { getManager } from '../adapters/network/mikrotik.js';

/**
 * Network activity monitor.
 * Provider access stays in the network adapter; Core only consumes the
 * provider contract needed to observe active sessions.
 */
class MonitorAgent {
  constructor() {
    this.active = new Set();
    this.interval = null;
    this.start();
  }

  start() {
    if (this.interval) return this;
    this.interval = setInterval(async () => {
      try {
        const users = await getManager().executeTool('users.active', {});
        const current = new Set((users || []).map((u) => u.user).filter(Boolean));

        current.forEach((user) => {
          if (!this.active.has(user)) eventBus.emit('user.login', { username: user });
        });

        this.active.forEach((user) => {
          if (!current.has(user)) eventBus.emit('user.logout', { username: user });
        });

        this.active = current;
      } catch {
        // Monitoring is observational; provider outages must not crash the runtime.
      }
    }, 5000);
    this.interval.unref?.();
    return this;
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    return this;
  }
}

export default new MonitorAgent();
