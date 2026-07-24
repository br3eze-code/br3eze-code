import TelegramBot from 'node-telegram-bot-api';
import eventBus from '../core/eventBus.js';

// src/interfaces/telegram.js

class Bot {
    constructor(token, agent) {
        this.bot = new TelegramBot(token, { polling: true }); 
        this.agent = agent;
        this.init();
    }

    init() {
        eventBus.on('user.login', (data) => {
            this.bot.sendMessage(process.env.ADMIN_CHAT, `🟢 ${data.username} logged in`).catch(() => {});
        });

        eventBus.on('user.logout', (data) => {
            this.bot.sendMessage(process.env.ADMIN_CHAT, `🔴 ${data.username} logged out`).catch(() => {});
        });

        // Register commands
        this.bot.onText(/\/kick (.+)/, async (msg, match) => {
            const username = match[1];
            try {
                await this.agent.handle({
                    tool: 'user.kick',
                    params: { username }
                });
                this.bot.sendMessage(msg.chat.id, `✅ User ${username} kicked`);
            } catch (err) {
                this.bot.sendMessage(msg.chat.id, `❌ Kick failed: ${err.message}`);
            }
        });
    }
}

export default Bot;