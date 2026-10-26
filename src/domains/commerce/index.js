import BaseDomain from '../BaseDomain.js';

/**
 * Commerce adapter boundary.
 *
 * Commerce capabilities are supplied by the host application; the general
 * AgentRuntime does not own commerce rules, persistence, or payment providers.
 * Inject tools explicitly so importing this domain never activates side effects.
 */
export class CommerceDomain extends BaseDomain {
  constructor({ tools = [], capabilities = ['commerce'] } = {}) {
    super();
    this.name = 'commerce';
    this.description = 'Adapter boundary for host-provided commerce capabilities.';
    this.capabilities = [...capabilities];
    for (const tool of tools) this.registerTool(tool);
  }
}

export default CommerceDomain;
