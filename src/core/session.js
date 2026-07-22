import eventBus from '../core/eventBus.js';

class SessionAgent {
    constructor() {
        this.sessions = new Map();
        this.init();
    }

    init() {
        eventBus.on('user.login', (data) => {
            this.sessions.set(data.username, {
                ...data,
                start: Date.now()
            });
        });

        eventBus.on('user.logout', (data) => {
            const session = this.sessions.get(data.username);
            if (session) {
                session.end = Date.now();
                console.log('Session ended:', session);
                this.sessions.delete(data.username);
            }
        });
    }
}

export default new SessionAgent();