// tools/telegram/sendMessage.js
// Telegram Messaging Tool — CJS

'use strict';

// Validate token eagerly so misconfiguration is caught at startup, not mid-send
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN) {
    throw new Error('[telegram/sendMessage] TELEGRAM_BOT_TOKEN env var is not set. Aborting module load.');
}

/**
 * TOOL: telegram.sendMessage
 * Sends message to a Telegram chat or user
 */
async function sendMessage({ chatId, message, parseMode = 'HTML' }) {
    if (!chatId || !message) {
        throw new Error('Missing chatId or message');
    }

    const TELEGRAM_API = 'https://api.telegram.org';

    try {
        const res = await fetch(`${TELEGRAM_API}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: parseMode
            })
        });

        const data = await res.json();

        if (!data.ok) {
            throw new Error(data.description || 'Telegram send failed');
        }

        return {
            status: 'sent',
            chatId,
            messageId: data.result.message_id
        };

    } catch (err) {
        const wrapped = new Error('telegram.sendMessage failed: ' + err.message);
        wrapped.cause = err;
        throw wrapped;
    }
}

module.exports = { sendMessage };