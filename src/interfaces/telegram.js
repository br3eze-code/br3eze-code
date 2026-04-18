'use strict';

const TelegramBot = require('node-telegram-bot-api');
const eventBus = require('../core/eventBus');

class Bot {
    constructor(token, agent, pairingService) {
        if (!token) throw new Error('Telegram token required');
        this.bot = new TelegramBot(token, { polling: true });
        this.agent = agent;
        this.pairing = pairingService; // Inject pairing service
        
        this.init();
    }

    init() {
        // Existing event handlers...
        eventBus.on('user.login', (data) => {
            if (process.env.ADMIN_CHAT) {
                this.bot.sendMessage(process.env.ADMIN_CHAT, `🟢 ${data.username} logged in`)
                    .catch(err => console.error('Telegram login notify failed:', err.message));
            }
        });

        // Handle pairing code generation requests
        eventBus.on('pairing.code.created', ({ formatted }) => {
            // This is triggered when code is generated, bot just needs to display it
        });

        // ONBOARDING COMMAND — This is what you were missing
        this.bot.onText(/\/onboard(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const location = match[1] || 'Unknown Location';
            
            try {
                // Generate pairing code
                const entry = this.pairing.generateCode({
                    source: 'telegram',
                    chatId: chatId.toString(),
                    username: msg.from.username || msg.from.first_name,
                    location: location
                });

                // Send code with instructions
                const script = this.pairing.generateRouterScript(entry.code);
                
                await this.bot.sendMessage(chatId, 
                    `🔐 **Router Onboarding Started**\n\n` +
                    `**Location**: ${location}\n` +
                    `**Code**: \`${entry.code}\`\n` +
                    `**Expires**: 15 minutes\n\n` +
                    `**Next Steps**:\n` +
                    `1. Open Winbox/WebFig\n` +
                    `2. Paste this script into New Terminal:\n\`\`\`routeros\n${script}\n\`\`\`\n` +
                    `3. Or manually run: /system/script/run agentos-onboard code=${entry.code}\n\n` +
                    `The router will automatically appear in your fleet once paired.`, 
                    { parse_mode: 'Markdown', disable_web_page_preview: true }
                );

                // Also send as file for easy copy-paste
                await this.bot.sendDocument(chatId, Buffer.from(script), {
                    filename: `agentos-onboard-${entry.code}.rsc`,
                    caption: 'RouterOS onboarding script'
                });

            } catch (err) {
                this.bot.sendMessage(chatId, `❌ Failed to generate pairing code: ${err.message}`);
            }
        });

        // Status command to see pending codes and paired routers
        this.bot.onText(/\/fleet/, async (msg) => {
            const stats = this.pairing.getStats();
            await this.bot.sendMessage(msg.chat.id,
                `📊 **Fleet Status**\n\n` +
                `⏳ Pending Codes: ${stats.pendingCodes}\n` +
                `🖥️ Active Routers: ${stats.activeRouters}\n\n` +
                `**Active Codes**:\n${stats.codes.map(c => 
                    `• \`${c.code}\` (${Math.floor(c.expiresIn/60000)}m left) - ${c.metadata.location}`
                ).join('\n') || 'None'}`,
                { parse_mode: 'Markdown' }
            );
        });

        // Existing /kick command...
        this.bot.onText(/\/kick (.+)/, async (msg, match) => {
            const username = match[1].trim();
            try {
                await this.agent.handle({
                    tool: 'user.kick',
                    params: { username }
                });
                this.bot.sendMessage(msg.chat.id, `✅ User *${username}* kicked`, { parse_mode: 'Markdown' });
            } catch (err) {
                this.bot.sendMessage(msg.chat.id, `❌ Failed: ${err.message}`);
            }
        });
    }

    // ... rest of existing methods ...
    async send(userId, message) {
        return this.bot.sendMessage(userId, message);
    }

    stop() {
        this.bot.stopPolling();
    }
}

module.exports = Bot;
