
// src/services/sessions.js

class SessionService {
    constructor(mikrotik, events) {
        this.mikrotik = mikrotik;
        this.events = events;
        this.active = new Map();
        this.monitorTimer = null;
    }

    monitor() {
        if (this.monitorTimer) return this;
        this.monitorTimer = setInterval(async () => {
            const users = await this.mikrotik.getActiveUsers();

            users.forEach(u => {
                if (!this.active.has(u.user)) {
                    this.active.set(u.user, u);

                    this.events.emit('user.login', u);
                }
            });

            // detect logout
            this.active.forEach((val, key) => {
                if (!users.find(u => u.user === key)) {
                    this.active.delete(key);
                    this.events.emit('user.logout', val);
                }
            });

        }, 5000);
        this.monitorTimer.unref?.();
        return this;
    }

    stopMonitoring() {
        if (this.monitorTimer) clearInterval(this.monitorTimer);
        this.monitorTimer = null;
        return this;
    }
}

export default SessionService;