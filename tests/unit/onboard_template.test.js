import { clearOnboardingProvider, registerOnboardingProvider } from '../../src/core/ports/onboarding.js';
import { generateSetupScript as generateAdapterSetupScript } from '../../src/adapters/network/onboard.js';
import { generateSetupScript } from '../../src/core/onboard.js';

describe('Onboarding provider contract', () => {
  const config = {
    AGENTOS_NODE_URL: 'http://1.2.3.4:3000',
    name: '1.2.3.4',
  };

  beforeEach(() => {
    clearOnboardingProvider();
    registerOnboardingProvider({ generateSetupScript: generateAdapterSetupScript });
  });

  afterEach(() => {
    clearOnboardingProvider();
  });

  test('routes setup generation through the registered adapter', () => {
    const script = generateSetupScript(config);
    expect(script).toContain('AgentOS-1.2.3.4');
    expect(script).toContain('http://1.2.3.4:3000');
  });

  test('disables insecure legacy services in the generated fallback', () => {
    const script = generateSetupScript(config);
    expect(script).toContain('/ip service set telnet disabled=yes');
    expect(script).toContain('/ip service set ftp disabled=yes');
  });

  test('does not interpolate missing values as the literal undefined', () => {
    const script = generateSetupScript({ AGENTOS_NODE_URL: 'http://localhost:3000' });
    expect(script).not.toContain('undefined');
  });
});
