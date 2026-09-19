import { generateSetupScript, registerOnboardingProvider } from '../../src/core/onboard.js';
import * as onboardingAdapter from '../../src/adapters/network/onboard.js';

registerOnboardingProvider(onboardingAdapter);

describe('Onboard Template Generation', () => {
    const mockEnv = {
        AGENTOS_NODE_URL: 'http://1.2.3.4:3000',
        TELEGRAM_BOT_TOKEN: 'test_token',
        TELEGRAM_CHAT_ID: 'test_chat_id'
    };

    test('should generate a script with correct dynamic values', async () => {
        const script = await generateSetupScript(mockEnv);
        
        expect(script).toContain('AgentOS-Node');
        expect(script).toContain('http://1.2.3.4:3000');
        expect(script).toContain('/ip service set telnet disabled=yes');
    });

    test('should not contain undefined strings', async () => {
        const script = await generateSetupScript(mockEnv);
        expect(script).not.toContain('undefined');
    });

    test('should generate a secure setup note', async () => {
        const script = await generateSetupScript(mockEnv);
        expect(script).not.toContain('undefined');
        expect(script).toContain('/system note set show-at-login=no');
    });
});
