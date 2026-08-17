import BaseDomain from '../BaseDomain.js';
import { logger } from '../../core/logger.js';

const CONTROL_COMMANDS = new Set(['start', 'stop', 'pause', 'resume', 'speak', 'set_voice']);

class VoiceDomain extends BaseDomain {
  constructor(config = {}) {
    super();
    this.name = 'voice';
    this.config = config;
    this.providers = config.providers || {};

    this.registerTool({
      name: 'generateTTS',
      description: 'Generate text-to-speech using a configured provider such as Minimax or ElevenLabs',
      execute: async (text, provider = 'minimax', options = {}) => {
        if (typeof text !== 'string' || !text.trim()) return { success: false, error: 'Text is required' };
        logger.info(`[VoiceDomain] Generating TTS via ${provider}`);
        if (!['minimax', 'elevenlabs'].includes(provider)) {
          return { success: false, error: 'Unsupported TTS provider' };
        }
        const adapter = this.providers[provider];
        if (adapter?.synthesize) {
          const result = await adapter.synthesize({ text: text.trim(), ...options });
          return { success: true, provider, ...result };
        }
        return {
          success: true,
          url: `https://cdn.br3eze.africa/voice/${provider}_mock.mp3`,
          provider,
          voiceId: options.voiceId || null,
          languageCode: options.languageCode || null,
        };
      },
    });

    this.registerTool({
      name: 'voiceClone',
      description: 'Clone a voice from an audio sample only after explicit owner consent',
      risk: 'high',
      execute: async (audioSampleUrl, targetText, options = {}) => {
        if (!audioSampleUrl || !targetText) return { success: false, error: 'Audio sample and target text are required' };
        if (options.consent !== true) return { success: false, error: 'Explicit voice consent is required' };
        if (!options.ownerId || !options.requestedBy) return { success: false, error: 'Voice owner and requester identities are required' };
        logger.info(`[VoiceDomain] Cloning voice for owner ${options.ownerId}`);
        const adapter = this.providers.elevenlabs;
        if (adapter?.clone) {
          const result = await adapter.clone({ audioSampleUrl, targetText, ...options });
          return { success: true, provider: 'elevenlabs', ...result };
        }
        return {
          success: true,
          provider: 'elevenlabs',
          url: 'https://cdn.br3eze.africa/voice/elevenlabs_cloned_mock.mp3',
          voiceId: options.voiceId || 'cloned-consented-voice',
          ownerId: options.ownerId,
        };
      },
    });

    this.registerTool({
      name: 'voiceControl',
      description: 'Control a voice session using an identity-linked, allow-listed command',
      risk: 'medium',
      execute: async (command, options = {}) => {
        if (!CONTROL_COMMANDS.has(command)) return { success: false, error: 'Unsupported voice control command' };
        if (!options.userId) return { success: false, error: 'Authenticated user is required' };
        const permissions = Array.isArray(options.permissions) ? options.permissions : [];
        if (!permissions.includes('voice.control') && !permissions.includes('*')) {
          return { success: false, error: 'voice.control permission is required' };
        }
        return {
          success: true,
          command,
          userId: options.userId,
          sessionId: options.sessionId || null,
          tenantId: options.tenantId || null,
          approvalRequired: ['stop', 'set_voice'].includes(command),
        };
      },
    });

    this.registerTool({
      name: 'soundDesign',
      description: 'Enhance or generate sound effects',
      execute: async (prompt) => {
        logger.info(`[VoiceDomain] Generating sound design for: ${prompt}`);
        return { success: true, url: 'https://cdn.br3eze.africa/voice/sfx_mock.mp3' };
      },
    });

    this.registerTool({
      name: 'streamWSS',
      description: 'Stream real-time voice synthesis via WebSocket',
      execute: async (text, wssEndpoint) => {
        logger.info(`[VoiceDomain] Streaming to WSS: ${wssEndpoint}`);
        return { success: true, status: 'streaming_started' };
      },
    });
  }
}

export default VoiceDomain;
