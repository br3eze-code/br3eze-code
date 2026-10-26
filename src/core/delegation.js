/**
 * Domain-neutral supervisor delegation tool.
 *
 * The model only sees an allowlisted set of tools, and AgentRuntime enforces
 * the same list again at execution time. A prompt-visible list alone is not a
 * security boundary.
 */
export function createDelegationTool({ name, description, runtime, allowedTools, systemInstruction, maxDepth = 2 } = {}) {
  if (typeof name !== 'string' || !name.trim() || !runtime ||
      !Array.isArray(allowedTools) || allowedTools.length === 0) {
    throw new TypeError('name, runtime, and a non-empty allowedTools list are required');
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 8) {
    throw new TypeError('maxDepth must be an integer between 1 and 8');
  }
  const allowlist = new Set(allowedTools.map((tool) => String(tool).trim()).filter(Boolean));
  if (!allowlist.size || allowlist.size !== allowedTools.length) {
    throw new TypeError('allowedTools must contain unique, non-empty tool names');
  }

  return {
    name: name.trim(),
    description: description || `Delegate a specialized task to ${name.trim()}`,
    requiresApproval: false,
    risk: 'medium',
    parameters: {
      type: 'object',
      properties: {
        subTaskPrompt: { type: 'string', description: 'Specific task for the specialist' },
      },
      required: ['subTaskPrompt'],
    },
    async execute({ subTaskPrompt } = {}, context = {}) {
      const prompt = String(subTaskPrompt || '').trim();
      if (!prompt) throw new TypeError('subTaskPrompt is required');
      const depth = Number(context.delegationDepth || 0);
      if (!Number.isInteger(depth) || depth < 0 || depth >= maxDepth) {
        throw new Error('Maximum delegation depth reached');
      }

      const registered = runtime.toolRegistry?.getAllTools?.() || [];
      const names = runtime.listTools?.() || registered.map((tool) => tool.fullName || tool.name);
      const missing = [...allowlist].filter((tool) => !names.includes(tool));
      if (missing.length) {
        throw new Error(`Delegation allowlist contains unregistered tools: ${missing.join(', ')}`);
      }
      const tools = registered
        .filter((tool) => allowlist.has(tool.fullName || tool.name))
        .map((tool) => ({
          name: tool.fullName || tool.name,
          description: tool.schema?.description || tool.description || '',
          parameters: tool.schema?.parameters || { type: 'object', properties: {} },
        }));
      if (tools.length !== allowlist.size) {
        throw new Error('Delegation could not resolve every allowlisted tool declaration');
      }

      const result = await runtime.execute({
        content: prompt,
        context: {
          ...context,
          delegationDepth: depth + 1,
          delegatedBy: context.userId || context.uid || null,
          allowedToolNames: [...allowlist],
          ...(systemInstruction ? { systemPrompt: String(systemInstruction) } : {}),
        },
        tools,
        maxTurns: 4,
      });
      return {
        agent: name.trim(),
        summary: result?.response ?? result?.content ?? '',
        toolsUsed: Array.isArray(result?.toolsUsed) ? result.toolsUsed : [],
      };
    },
  };
}

export default createDelegationTool;
