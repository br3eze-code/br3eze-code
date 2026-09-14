import { generateSetupScript } from '../../src/core/ports/onboarding.js';

describe('Onboard Template Generation', () => {
    const mockEnv = {
        AGENTOS_NODE_URL: 'http://1.2.3.4:3000',
        TELEGRAM_BOT_TOKEN: 'test_token',
        TELEGRAM_CHAT_ID: 'test_chat_id'
    };

    test('should generate a script with correct dynamic values', () => {
        const script = generateSetupScript(mockEnv);
