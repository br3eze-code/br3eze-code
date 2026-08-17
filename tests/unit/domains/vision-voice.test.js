import VisionDomain from '../../../src/domains/vision/index.js';
import VoiceDomain from '../../../src/domains/voice/index.js';

describe('VisionDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new VisionDomain();
  });

  test('registers generateImage and editImage tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['editImage', 'generateImage', 'recommendProducts']);
  });

  test('generateImage() defaults to the openai provider', async () => {
    const result = await domain.execute({ tool: 'generateImage', params: 'a sunset' });
    expect(result).toEqual({
      success: true,
      url: 'https://cdn.br3eze.africa/vision/openai_mock.png',
      provider: 'openai',
    });
  });

  test('generateImage() honors an explicit provider via multi-arg params', async () => {
    const result = await domain.execute({
      tool: 'generateImage',
      params: ['a sunset', 'nanobanana'],
    });
    expect(result.provider).toBe('nanobanana');
    expect(result.url).toContain('nanobanana_mock');
  });

  test('generateImage() reports an error for an unsupported provider', async () => {
    const result = await domain.execute({
      tool: 'generateImage',
      params: ['a sunset', 'midjourney'],
    });
    expect(result).toEqual({ success: false, error: 'Unsupported image provider' });
  });

  test('editImage() binds imageUrl and prompt to separate positional arguments', async () => {
    const result = await domain.execute({
      tool: 'editImage',
      params: ['https://example.com/a.png', 'make it blue'],
    });
    expect(result.success).toBe(true);
    expect(result.url).toContain('edited_mock');
  });
});

describe('VoiceDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new VoiceDomain();
  });

  test('registers generateTTS, voiceClone, soundDesign, streamWSS tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual([
      'generateTTS',
      'soundDesign',
      'streamWSS',
      'voiceClone',
      'voiceControl',
    ]);
  });

  test('generateTTS() defaults to the minimax provider', async () => {
    const result = await domain.execute({ tool: 'generateTTS', params: 'hello world' });
    expect(result).toEqual({
      success: true,
      url: 'https://cdn.br3eze.africa/voice/minimax_mock.mp3',
      provider: 'minimax',
    });
  });

  test('generateTTS() supports ElevenLabs without requiring a network call', async () => {
    const result = await domain.execute({
      tool: 'generateTTS',
      params: ['hello from AgentOS', 'elevenlabs', { voiceId: 'voice-1', languageCode: 'en-US' }],
    });
    expect(result).toMatchObject({
      success: true,
      provider: 'elevenlabs',
      voiceId: 'voice-1',
      languageCode: 'en-US',
    });
    expect(result.url).toContain('elevenlabs_mock');
  });

  test('voiceClone() requires explicit consent and identity-linked ownership', async () => {
    const denied = await domain.execute({
      tool: 'voiceClone',
      params: ['https://example.com/sample.mp3', 'say this instead'],
    });
    expect(denied).toEqual({ success: false, error: 'Explicit voice consent is required' });

    const result = await domain.execute({
      tool: 'voiceClone',
      params: ['https://example.com/sample.mp3', 'say this instead', {
        consent: true,
        ownerId: 'voice-owner-1',
        requestedBy: 'operator-1',
      }],
    });
    expect(result).toMatchObject({
      success: true,
      provider: 'elevenlabs',
      ownerId: 'voice-owner-1',
    });
    expect(result.url).toContain('elevenlabs_cloned_mock');
  });

  test('voiceControl() requires identity and permission, and gates sensitive commands', async () => {
    await expect(domain.execute({
      tool: 'voiceControl', params: ['start', { userId: 'operator-1' }],
    })).resolves.toEqual({ success: false, error: 'voice.control permission is required' });

    await expect(domain.execute({
      tool: 'voiceControl', params: ['start', { userId: 'operator-1', permissions: ['voice.control'], tenantId: 'tenant-a' }],
    })).resolves.toMatchObject({ success: true, command: 'start', tenantId: 'tenant-a', approvalRequired: false });

    await expect(domain.execute({
      tool: 'voiceControl', params: ['set_voice', { userId: 'operator-1', permissions: ['voice.control'] }],
    })).resolves.toMatchObject({ success: true, approvalRequired: true });
  });

  test('soundDesign() accepts a single prompt argument', async () => {
    const result = await domain.execute({ tool: 'soundDesign', params: 'a thunderstorm' });
    expect(result.success).toBe(true);
  });

  test('streamWSS() binds text and wssEndpoint to separate positional arguments', async () => {
    const result = await domain.execute({
      tool: 'streamWSS',
      params: ['hello', 'wss://example.com/stream'],
    });
    expect(result).toEqual({ success: true, status: 'streaming_started' });
  });
});
