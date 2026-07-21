import VisionDomain from '../../../src/domains/vision/index.js';
import VoiceDomain from '../../../src/domains/voice/index.js';

describe('VisionDomain', () => {
  let domain;
  beforeEach(() => {
    domain = new VisionDomain();
  });

  test('registers generateImage and editImage tools', () => {
    expect(domain.getSkills().map(t => t.name).sort()).toEqual(['editImage', 'generateImage']);
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

  test('generateTTS() reports an error for an unsupported provider', async () => {
    const result = await domain.execute({
      tool: 'generateTTS',
      params: ['hello', 'elevenlabs'],
    });
    expect(result).toEqual({ success: false, error: 'Unsupported TTS provider' });
  });

  test('voiceClone() binds audioSampleUrl and targetText to separate positional arguments', async () => {
    const result = await domain.execute({
      tool: 'voiceClone',
      params: ['https://example.com/sample.mp3', 'say this instead'],
    });
    expect(result.success).toBe(true);
    expect(result.url).toContain('cloned_mock');
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
