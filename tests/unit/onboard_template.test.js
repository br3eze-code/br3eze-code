import { generateSetupScript } from '../../src/adapters/network/onboard.js';

describe('Network onboarding setup script', () => {
    const mockEnv = {
        AGENTOS_NODE_URL: 'http://1.2.3.4:3000',
        name: 'test-node',
        TELEGRAM_BOT_TOKEN: 'test_token',
        TELEGRAM_CHAT_ID: 'test_chat_id'
    };

    test('generates a script with the supplied node identity and endpoint', () => {
        const script = generateSetupScript(mockEnv);
        expect(script).toContain('http://1.2.3.4:3000');
        expect(script).toContain('AgentOS-test-node');
        expect(script).toContain('/ip service set telnet disabled=yes');
        expect(script).toContain('/ip service set ftp disabled=yes');
    });

    test('does not contain undefined values or injected identity quotes', () => {
        const script = generateSetupScript({ ...mockEnv, name: 'test"node' });
        expect(script).not.toContain('undefined');
        expect(script).toContain('AgentOS-testnode');
    });

    test('does not emit unsupported login-by configuration', () => {
        const script = generateSetupScript(mockEnv);
        expect(script).not.toContain('login-by=');
    });
});
