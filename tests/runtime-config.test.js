import { resolveRuntimeConfig, validateRuntimeConfig } from '../src/core/runtime-config.js';

describe('runtime configuration', () => {
  test('environment values override config values for onboarding and storyline', () => {
    const runtime = resolveRuntimeConfig({
      env: {
        AGENTOS_API_BASE_URL: 'https://api.example.test',
        AGENTOS_ONBOARDING_PAIRING_TTL_MS: '120000',
        AGENTOS_STORYLINE_MAX_CACHE_ENTRIES: '25',
        AGENTOS_STORYLINE_MODE: 'shared',
        FIREBASE_PROJECT_ID: 'configured-project'
      },
      config: {
        name: 'Configured AgentOS',
        public: { apiBaseUrl: 'https://config.example.test' },
        onboarding: { pairingTtlMs: 600000 },
        storyline: { maxCacheEntries: 100, defaultMode: 'isolated' },
        firebase: { projectId: 'file-project' }
      }
    });

    expect(runtime.public.apiBaseUrl).toBe('https://api.example.test');
    expect(runtime.onboarding.pairingTtlMs).toBe(120000);
    expect(runtime.storyline.maxCacheEntries).toBe(25);
    expect(runtime.storyline.defaultMode).toBe('shared');
    expect(runtime.firebase.projectId).toBe('configured-project');
  });

  test('validation rejects missing API base URL when required', () => {
    expect(() => validateRuntimeConfig(resolveRuntimeConfig({ env: {}, config: {} }), { requireApi: true }))
      .toThrow(/AGENTOS_API_BASE_URL/);
  });
});
