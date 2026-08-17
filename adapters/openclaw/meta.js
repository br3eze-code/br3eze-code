/**
 * adapters/openclaw/meta.js
 *
 * Produces an OpenClaw-compatible skill manifest from the local AgentKernel instance.
 * This file is used by the AgentHarness to advertise this node's capabilities
 * to a parent OpenClaw gateway.
 *
 * Usage:
 *   const makeMeta = require('./adapters/openclaw/meta');
 *   const manifest = makeMeta(kernelInstance);
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

/**
 * @param {import('../../src/core/agentKernel')} kernelInstance  Live AgentKernel
 * @returns {object}  OpenClaw-compatible skill manifest
 */
function agentOSAdapter(kernelInstance) {
  const skills = [];

  // getTools() iterates registered domains and returns { name, description, parameters, risk }
  const tools = kernelInstance && typeof kernelInstance.getTools === 'function'
    ? kernelInstance.getTools()
    : {};

  for (const [name, spec] of Object.entries(tools)) {
    skills.push({
      name,
      description:  spec.description  || '',
      parameters:   spec.parameters   || {},
      risk:         spec.risk         || 'low',
      execute: async (args, context) => {
        const ctx = {
          userId:    context?.user_id   || 'openclaw_user',
          workspace: context?.workspace || process.env.AGENTOS_STATE_PATH || '/data/agentos',
        };
        return kernelInstance.execute(name, args, ctx);
      },
    });
  }

  return {
    id:          process.env.AGENTOS_AGENT_ID || 'agentos',
    name:        process.env.AGENTOS_AGENT_NAME || 'AgentOS',
    version:     pkg.version,
    description: 'Domain-agnostic AI agent with multi-channel, multi-skill support',
    author:      'AgentOS',
    skills,
  };
}

export default agentOSAdapter;
