import eventBus from '../core/eventBus.js';

import mikrotik from '../agents/mikrotik.agent.js';


class MonitorAgent {
    constructor() {
        this.active = new Set();
        this.interval = null;
        this.start();
    }

    start() {
        if (this.interval) return this;
        this.interval = setInterval(async () => {
            const users = await mikrotik.getActiveUsers();

            const current = new Set(users.map(u => u.user));

            // LOGIN DETECT
            current.forEach(user => {
                if (!this.active.has(user)) {
                    eventBus.emit('user.login', { username: user });
                }
            });

            // LOGOUT DETECT
            this.active.forEach(user => {
                if (!current.has(user)) {
                    eventBus.emit('user.logout', { username: user });
                }
            });

            this.active = current;

        }, 5000);
        // Monitoring must not prevent a clean CLI/test process shutdown.
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
