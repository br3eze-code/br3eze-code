/**
 * Domain-neutral supervisor delegation skill factory.
 * Each delegate receives a fixed, allowlisted tool set and the caller's scoped context.
 */
export function createDelegationTool({ name, description, runtime, allowedTools, systemInstruction, maxDepth = 2 }) {
  if (!name || !runtime || !Array.isArray(allowedTools) || !allowedTools.length) {
    throw new TypeError('name, runtime, and a non-empty allowedTools list are required');
  }
  const allowlist = new Set(allowedTools);
  return {
    name,
    description: description || `Delegate a specialized task to ${name}`,
    requiresApproval: false,
    parameters: {
      type: 'object',
      properties: { subTaskPrompt: { type: 'string', description: 'Specific task for the specialist' } },
      required: ['subTaskPrompt'],
    },
    async execute({ subTaskPrompt }, context = {}) {
      if (!String(subTaskPrompt || '').trim()) throw new TypeError('subTaskPrompt is required');
      const depth = Number(context.delegationDepth || 0);
      if (depth >= maxDepth) throw new Error('Maximum delegation depth reached');
      const registeredNames = new Set(runtime.listTools?.() || []);
      const missing = [...allowlist].filter(tool => !registeredNames.has(tool));
      if (missing.length) {
        throw new Error(`Delegation allowlist contains unregistered tools: ${missing.join(', ')}`);
      }
      const allDeclarations = runtime.toolRegistry?.getToolsForLLM?.() || [];
      const allowedDeclarations = allDeclarations.filter((declaration) => {
        const declaredName = declaration?.function?.name?.replace(/__/g, '.') || declaration?.name;
        return allowlist.has(declaredName);
      });
      if (allowedDeclarations.length !== allowlist.size) {
        throw new Error('Delegation allowlist could not be resolved to complete model tool declarations');
      }
      const result = await runtime.execute({
        content: String(subTaskPrompt),
        context: {
          ...context,
          delegationDepth: depth + 1,
          delegatedBy: context.userId || context.uid || null,
        },
        tools: allowedDeclarations,
        maxTurns: 4,
      });
      return { agent: name, summary: result.response ?? result.content ?? '', toolsUsed: result.toolsUsed || [] };
    },
  };
}
export default createDelegationTool;
