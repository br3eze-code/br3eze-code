import { ObsidianVaultAdapter } from '../../integrations/obsidian.js';
import { defineSkill, defineTool } from '../../runtime/skill.js';

function getAdapter(context = {}) {
  const supplied = context.obsidianAdapter || context.deps?.obsidianAdapter || context.workspace?.obsidianAdapter;
  if (supplied) return supplied;
  const vaultRoot = context.config?.obsidian?.vaultRoot || process.env.AGENTOS_OBSIDIAN_VAULT;
  if (!vaultRoot) throw new Error('Obsidian adapter unavailable: provide context.obsidianAdapter or AGENTOS_OBSIDIAN_VAULT');
  return new ObsidianVaultAdapter({
    vaultRoot,
    audit: context.audit || context.logger?.audit || (async () => {}),
    uriOpener: context.uriOpener || null
  });
}

function requireContext(context = {}) {
  if (!context.userId) throw new Error('authenticated identity required');
  return context;
}

const obsidianSkill = defineSkill({
  name: 'workspace.obsidian',
  description: 'Domain-neutral, scoped Obsidian vault access and graph context for agents.',
  persona: 'Use Obsidian only through scoped workspace tools. Preserve tenant, domain, site, identity, and approval context. Never expose raw vault paths outside the configured vault or transmit note contents without an explicit read request.',
  tools: [
    defineTool({
      name: 'workspace.obsidian.status',
      description: 'Check whether the configured Obsidian vault is available.',
      parameters: { type: 'object', properties: {} },
      handler: async (_args, context) => {
        const safeContext = requireContext(context);
        const adapter = getAdapter(safeContext);
        return { available: await adapter.isAvailable(), scope: safeScope(safeContext) };
      }
    }),
    defineTool({
      name: 'workspace.obsidian.read_note',
      description: 'Read one vault-relative Markdown note with identity-linked audit context.',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      handler: async ({ path }, context) => getAdapter(requireContext(context)).readNote(path, context)
    }),
    defineTool({
      name: 'workspace.obsidian.graph_context',
      description: 'Extract bounded wikilinks and tags from one note for graph-aware agent context.',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, maxChars: { type: 'number' } } },
      handler: async ({ path, maxChars }, context) => getAdapter(requireContext(context)).graphContext(path, context, { maxChars })
    }),
    defineTool({
      name: 'workspace.obsidian.open_note',
      description: 'Create an encoded Obsidian URI for a vault-relative note.',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, vault: { type: 'string' } } },
      handler: async ({ path, vault }, context) => getAdapter(requireContext(context)).open(path, context, { vault })
    }),
    defineTool({
      name: 'workspace.obsidian.write_note',
      description: 'Write a vault-relative note; requires an authenticated approved context.',
      parameters: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
      handler: async ({ path, content }, context) => getAdapter(requireContext(context)).writeNote(path, content, context)
    }),
    defineTool({
      name: 'workspace.obsidian.create_note',
      description: 'Create and optionally open a vault-relative note; requires approval.',
      parameters: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, content: { type: 'string' }, vault: { type: 'string' } } },
      handler: async ({ path, content = '', vault }, context) => getAdapter(requireContext(context)).create(path, content, context, { vault })
    })
  ],
  match(input) {
    const value = String(input).trim();
    const read = value.match(/^(?:obsidian|note)\s+read\s+(.+)$/i);
    if (read) return { tool: 'workspace.obsidian.read_note', args: { path: read[1] } };
    const graph = value.match(/^(?:obsidian|note)\s+graph\s+(.+)$/i);
    if (graph) return { tool: 'workspace.obsidian.graph_context', args: { path: graph[1] } };
    return null;
  }
});

function safeScope(context) {
  return {
    userId: context.userId,
    tenantId: context.scope?.tenantId ?? context.tenantId ?? null,
    domain: context.scope?.domain ?? context.domain ?? null,
    siteId: context.scope?.siteId ?? context.siteId ?? null
  };
}

export { obsidianSkill, getAdapter };
export default obsidianSkill;
