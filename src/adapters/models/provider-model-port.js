/**
 * Adapts provider SDKs to AgentRuntime's provider-neutral model port.
 * Provider-specific configuration stays in the host/composition layer.
 */
export function createProviderModelPort({ provider } = {}) {
  if (!provider || typeof provider.generate !== 'function') {
    throw new TypeError('provider must implement generate(messages, tools)');
  }

  const providerName = String(provider.id || provider.name || provider.constructor?.name || 'configured')
    .replace(/Provider$/i, '').toLowerCase();

  return Object.freeze({
    providerName,
    async execute(request = {}) {
      const messages = Array.isArray(request.messages) ? [...request.messages] : [];
      const context = request.context || {};
      if (context.systemPrompt) {
        const systemMessages = messages.filter((message) => message?.role === 'system');
        const systemText = [
          String(context.systemPrompt),
          ...systemMessages.map((message) => message.content).filter(Boolean).map(String),
        ].join('\n\n');
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          if (messages[index]?.role === 'system') messages.splice(index, 1);
        }
        messages.unshift({ role: 'system', content: systemText });
      }
      const tools = normalizeToolDeclarations(request.tools);
      const response = await provider.generate(messages, tools, context);
      const calls = response?.toolCalls ?? response?.calls ?? [];

      return {
        content: response?.content ?? response?.text ?? '',
        toolCalls: Array.isArray(calls)
          ? calls.filter((call) => call && (call.name || call.function?.name)).map((call) => ({
              id: call.id || call.callId || null,
              name: call.name || call.function?.name,
              arguments: call.arguments ?? call.args ?? call.function?.arguments ?? {},
            }))
          : [],
        provider: response?.provider || provider.name || null,
        usage: response?.usage || null,
      };
    },
  });
}

function normalizeToolDeclarations(tools) {
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    const declaration = tool?.function || tool;
    if (!declaration?.name) return null;
    return {
      name: declaration.name,
      description: declaration.description || '',
      parameters: declaration.parameters && typeof declaration.parameters === 'object'
        ? declaration.parameters
        : { type: 'object', properties: {} },
    };
  }).filter(Boolean);
}
