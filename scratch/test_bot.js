
const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

const token = process.env.TELEGRAM_TOKEN;
if (!token) {
    console.error('TELEGRAM_TOKEN not found in .env');
    process.exit(1);
}

const bot = new TelegramBot(token);

bot.getMe().then(me => {
    console.log('Bot is healthy:', me.username);
    process.exit(0);
}).catch(err => {
    console.error('Bot failed:', err.message);
    process.exit(1);
});
