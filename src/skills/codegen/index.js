import { BaseDriver } from '../base.js';
import { logger as defaultLogger } from '../../core/logger.js';
import {
  CAPABILITIES,
  normalizeIotContext,
  assertCapability,
  assertDeviceVisible,
  redactIotContext
} from '../../core/iot-context.js';

const TARGETS = Object.freeze({
  routeros: {
    provider: 'mikrotik',
    language: 'routeros',
    outputRule: 'Output only valid RouterOS v7 .rsc command lines beginning with /. Do not include markdown.'
  },
  fastapi: {
    provider: 'generic-api',
    language: 'python',
    outputRule: 'Output a complete FastAPI module with typed request/response models and an /health route. Do not include markdown fences.'
  },
  python: {
    provider: 'generic-runtime',
    language: 'python',
    outputRule: 'Output valid Python 3 code without markdown fences.'
  },
  node: {
    provider: 'generic-runtime',
    language: 'javascript',
    outputRule: 'Output valid ESM JavaScript without markdown fences.'
  }
});

function resolveTarget(args = {}) {
  const requested = String(args.target || args.framework || (args.language === 'python' ? 'python' : 'routeros')).toLowerCase();
  return TARGETS[requested] ? { name: requested, ...TARGETS[requested] } : {
    name: requested,
    provider: String(args.provider || 'generic-runtime'),
    language: String(args.language || 'text'),
    outputRule: 'Output only executable source code without markdown fences.'
  };
}

function extractText(response) {
  return String(response?.text || response?.output || response?.content || '').trim();
}

class CodegenSkill extends BaseDriver {
  static id = 'codegen';
  static name = 'Provider-neutral AI Codegen';
  static description = 'Generate supervised code for network, IoT, and API targets using authorized context';

  constructor(config, logger) {
    super(config, logger || defaultLogger);
  }

  static getTools() {
    return {
      'codegen.generate': {
        risk: 'medium',
        description: 'Generate supervised source code for an authorized IoT, network, or API target',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'What to generate' },
            target: { type: 'string', enum: ['routeros', 'fastapi', 'python', 'node'] },
            language: { type: 'string' },
            framework: { type: 'string' },
            provider: { type: 'string' },
            siteId: { type: 'string' },
            deviceId: { type: 'string' },
            domain: { type: 'string' },
            contextLevel: { type: 'string', enum: ['tenant', 'domain', 'site', 'device', 'session'] }
          },
          required: ['prompt']
        }
      }
    };
  }

  async execute(toolName, args = {}, ctx = {}) {
    if (toolName !== 'codegen.generate') throw new Error(`Unsupported codegen tool: ${toolName}`);
    const prompt = String(args.prompt || '').trim();
    if (!prompt) throw new Error('Code generation prompt is required');

    const iotContext = normalizeIotContext({ ...ctx, ...args, scope: ctx.scope || ctx.authorization });
    assertCapability(iotContext, CAPABILITIES.CODE_GENERATE);
    const target = resolveTarget(args);
    if (args.siteId || args.deviceId || args.domain) {
      assertDeviceVisible(iotContext, { domain: args.domain, siteId: args.siteId, deviceId: args.deviceId });
    }

    const agent = ctx.agent || global.agent;
    const provider = target.provider === 'mikrotik' ? (agent?.mikrotik || global.mikrotik) : null;
    const llm = ctx.llm || agent?.llm || agent?.gemini || global.gemini;
    if (!llm) throw new Error('Configured code-generation model is unavailable');

    let targetFacts = '';
    if (provider && provider.state?.isConnected) {
      try {
        const stats = await provider.executeTool('system.stats');
        targetFacts = `Target facts: version=${stats.version || 'unknown'}, board=${stats.board || 'unknown'}.`;
      } catch (error) {
        this.logger?.debug?.(`[CodegenSkill] Target facts unavailable: ${error.message}`);
      }
    }

    const system = [
      'You are a supervised, provider-neutral code-generation assistant.',
      `Target: ${target.name}; provider: ${target.provider}; language: ${target.language}.`,
      target.outputRule,
      'Never emit credentials, access tokens, private IP inventories, or commands that bypass authorization.',
      'Generated code must be reviewed and approved before execution.',
      targetFacts
    ].filter(Boolean).join('\n');

    this.logger?.info?.(`[CodegenSkill] Generating ${target.name} code for scoped context ${redactIotContext(iotContext).contextLevel}`);
    const response = await llm.generate({
      model: ctx.model || 'gemini-2.5-flash',
      system,
      prompt: `Authorized context: ${JSON.stringify(redactIotContext(iotContext))}\nGenerate code for: ${prompt}`
    });
    const code = extractText(response).replace(/^```[a-z]*\n/i, '').replace(/\n```$/i, '').trim();
    if (!code) throw new Error('Code-generation provider returned empty output');
    if (target.name === 'routeros' && !code.startsWith('/')) {
      throw new Error('Generated RouterOS output is not a valid command sequence');
    }
    if (/((api[_-]?key|secret|password|token)\s*[:=]\s*['"]).+/i.test(code)) {
      throw new Error('Generated code contains a possible embedded secret');
    }

    return {
      success: true,
      target: target.name,
      provider: target.provider,
      language: target.language,
      prompt,
      code,
      context: redactIotContext(iotContext),
      approvalRequired: true,
      warning: 'Review and approve generated code before applying it to production devices or services.'
    };
  }
}

export { TARGETS, resolveTarget };
export default CodegenSkill;

