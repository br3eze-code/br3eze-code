'use strict';
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../src/core/channels/TelegramChannel.js');
let content = fs.readFileSync(file, 'utf8');

const marker = `            case 'reprint':
                await this._handleReprint({ chat: { id: chatId } });
                break;
        }
    }`;

if (!content.includes(marker)) {
  // Already patched or different version
  if (content.includes("case 'dahua':")) {
    console.log('Already patched.');
    process.exit(0);
  }
  console.error('ERROR: marker not found');
  process.exit(1);
}

const replacement = `            case 'reprint':
                await this._handleReprint({ chat: { id: chatId } });
                break;
            case 'dahua':
                await this._handleDahuaCallback(chatId, action, extra, messageId, query);
                break;
        }
    }

    async _handleDahuaCallback(chatId, action, deviceAndCh, messageId, query) {
        const [deviceId, chStr] = (deviceAndCh || '').split(':');
        const ch = parseInt(chStr) || 1;

        if (action === 'dismiss') {
            await this.bot.sendMessage(chatId, 'Alert dismissed.').catch(() => {});
            return;
        }

        await this.bot.sendChatAction(chatId, 'typing').catch(() => {});

        try {
            if (action === 'snap') {
                const result = await this.agent.executeTool('dahua.snapshot.get', { device: deviceId, channel: ch }, { userId: chatId, channel: 'telegram' });
                if (result && result.base64) {
                    await this.bot.sendPhoto(chatId, Buffer.from(result.base64, 'base64'), { caption: 'Live snapshot ' + deviceId + ' ch' + ch });
                } else {
                    await this.bot.sendMessage(chatId, 'Snapshot returned no data.');
                }

            } else if (action === 'stream') {
                const result = await this.agent.executeTool('dahua.stream.url', { device: deviceId, channel: ch }, { userId: chatId, channel: 'telegram' });
                await this.bot.sendMessage(chatId,
                    '*Live Stream* ' + deviceId + ' ch' + ch + '\\n\\nMain: \`' + result.main + '\`\\nSub: \`' + result.sub + '\`\\n\\n_Open with VLC._',
                    { parse_mode: 'Markdown' });

            } else if (action === 'snapall') {
                const results = await this.agent.executeTool('dahua.snapshot.getAll', { device: deviceId }, { userId: chatId, channel: 'telegram' });
                for (const shot of results) {
                    if (shot.base64) {
                        await this.bot.sendPhoto(chatId, Buffer.from(shot.base64, 'base64'), { caption: 'Ch ' + shot.channel + ' ' + (shot.name || deviceId) });
                    } else {
                        await this.bot.sendMessage(chatId, 'Ch ' + shot.channel + ': ' + shot.error);
                    }
                }

            } else if (action === 'mute') {
                const notifier = this.agent && this.agent.dahuaNotifier;
                if (notifier) {
                    // Advance the cooldown timestamp so this (device,*,ch) key won't alert for 1 more hour
                    ['SmartMotionHuman','SmartMotionVehicle','VideoMotion','CrossLineDetection','CrossRegionDetection','AlarmLocal'].forEach(code => {
                        const muteKey = deviceId + '|' + code + '|' + ch;
                        notifier.lastAlert.set(muteKey, Date.now() + 59 * 60000);
                    });
                    await this.bot.sendMessage(chatId, 'Alerts muted for ' + deviceId + ' ch' + ch + ' for 1 hour.');
                } else {
                    await this.bot.sendMessage(chatId, 'Could not access notifier.');
                }

            } else if (action === 'info') {
                const result = await this.agent.executeTool('dahua.device.info', { device: deviceId }, { userId: chatId, channel: 'telegram' });
                const text = 'Camera info ' + deviceId + '\\n\`\`\`json\\n' + JSON.stringify(result, null, 2).slice(0, 3000) + '\\n\`\`\`';
                await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });

            } else if (action === 'reboot') {
                await this.bot.sendMessage(chatId, 'Rebooting ' + deviceId + '... reconnects in ~30s.');
                await this.agent.executeTool('dahua.system.reboot', { device: deviceId, reason: 'Telegram quick-action reboot' }, { userId: chatId, channel: 'telegram' });

            } else if (action === 'events') {
                const { STATE_PATH } = require('../config');
                const logPath = require('path').join(STATE_PATH, 'dahua-events.jsonl');
                const fsm = require('fs');
                if (!fsm.existsSync(logPath)) return this.bot.sendMessage(chatId, 'No events logged yet.');
                const lines = fsm.readFileSync(logPath, 'utf8').trim().split('\\n').slice(-20);
                const events = lines.map(l => {
                    try {
                        const e = JSON.parse(l);
                        return e.ts.slice(11, 19) + ' [' + e.device + '] ch' + e.channel + ' ' + e.code + ' ' + e.action;
                    } catch (_) { return l; }
                });
                await this.bot.sendMessage(chatId,
                    'Last ' + events.length + ' events:\\n\`\`\`\\n' + events.join('\\n') + '\\n\`\`\`',
                    { parse_mode: 'Markdown' });

            } else if (action === 'ask') {
                await this.bot.sendMessage(chatId,
                    'What would you like to know about the ' + deviceId + ' ch' + ch + ' alert? Just type your question.');
            }
        } catch (err) {
            logger.error('TelegramChannel dahua callback error (' + action + '):', err.message);
            await this.bot.sendMessage(chatId, 'Error: ' + err.message);
        }
    }`;

content = content.replace(marker, replacement);
fs.writeFileSync(file, content);
console.log('Patched TelegramChannel.js successfully. New length:', content.length);
