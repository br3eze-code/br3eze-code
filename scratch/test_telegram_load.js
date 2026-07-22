
const TelegramChannel = require('../src/core/channels/TelegramChannel');
const { logger } = require('../src/core/logger');

(async () => {
    try {
        const config = {
            token: '123456789:ABCDEFGH-IJKLMNOPQRST-UVWXYZ1234567' // Valid format but invalid token
        };
        const agent = {
            mikrotik: { state: { isConnected: false } }
        };
        const channel = new TelegramChannel(config, agent);
        console.log('Successfully instantiated TelegramChannel');

        // Simulate callback_query
        const query = {
            id: '123',
            from: { id: 12345, username: 'testuser' },
            message: {
                chat: { id: 12345 },
                message_id: 678
            },
            data: 'action:dashboard'
        };

        console.log('Simulating callback_query...');
        const callbackListener = channel._rl(channel._handleCallback.bind(channel));
        await callbackListener(query);
        console.log('Callback simulation complete');
    } catch (err) {
        console.error('CRASH DETECTED:', err);
    }
})();
