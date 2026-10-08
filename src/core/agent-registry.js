/**
 * Canonical domain-neutral agent registry.
 *
 * This is the single identity/capability boundary for AgentOS agents.
 * It accepts both professional role profiles and executable specialist
 * definitions so legacy registries can become compatibility views instead
 * of competing sources of truth.
 */
export class AgentRegistry {
  constructor({ definitions = [] } = {}) {
    this.agents = new Map();
  }

  register(definition = {}) {
    const role = normalizeRole(definition.role || definition.id);
    if (!role) throw new TypeError('agent role or id is required');

    const id = String(definition.id || `${role}-agent`).trim().toLowerCase();
    if (this.agents.has(role) || this.agents.has(id)) {
      throw new Error(`Agent "${role}" already registered`);
    }

    const agent = freezeAgent({
      id,
      role,
      name: definition.name || definition.label || role,
      label: definition.label || definition.name || role,
      domain: definition.domain || 'general',
      description: definition.description || '',
      capabilities: definition.capabilities || [],
      approvalRequired: definition.approvalRequired || [],
      domains: definition.domains || ['*'],
      skills: definition.skills || definition.skillNames || [],
      skillNames: definition.skillNames || definition.skills || [],
      tools: definition.tools || [],
      permissions: definition.permissions || [],
      dependsOn: definition.dependsOn || [],
      handoffsTo: definition.handoffsTo || definition.handoffs || [],
      handoffs: definition.handoffs || definition.handoffsTo || [],
      ticketTypes: definition.ticketTypes || [],
      defaultNextAction: definition.defaultNextAction || '',
    });

    this.agents.set(role, agent);
    this.agents.set(id, agent);
    return agent;
  }

  registerMany(definitions = []) {
    for (const definition of definitions) this.register(definition);
    return this;
  }

  has(ref) {
    return Boolean(this.get(ref));
  }

  get(ref) {
    if (ref == null) return null;
    return this.agents.get(String(ref).trim().toLowerCase()) || null;
  }

  resolve(input = {}) {
    if (typeof input === 'string') return this.get(input);
    return this.get(
      input.agentRole ||
      input.agentPersona ||
      input.professionalRole ||
      input.role ||
      input.agentId ||
      input.id
    );
  }

  list() {
    return [...new Map([...this.agents.values()].map((agent) => [agent.id, agent])).values()];
  }

  capabilities(ref) {
    return this.get(ref)?.capabilities || [];
  }

  approvalRequired(ref, action) {
    const agent = this.get(ref);
    if (!agent || typeof action !== 'string') return false;
    return agent.approvalRequired.some((required) =>
      action === required ||
      action.startsWith(`${required}.`) ||
      action.startsWith(`${required}:`)
    );
  }

  canPropose(ref, capability) {
    return this.capabilities(ref).includes(capability);
  }

  canHandle(ref, ticketType) {
    const agent = this.get(ref);
    return Boolean(agent && (!agent.ticketTypes.length || agent.ticketTypes.includes(ticketType)));
  }
}

function normalizeRole(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[\\s_-]+/g, '');
  return normalized || null;
}

function freezeArray(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function freezeAgent(agent) {
  return Object.freeze({
    ...agent,
    capabilities: freezeArray(agent.capabilities),
    approvalRequired: freezeArray(agent.approvalRequired),
    domains: freezeArray(agent.domains),
    skills: freezeArray(agent.skills),
    skillNames: freezeArray(agent.skillNames),
    tools: freezeArray(agent.tools),
    permissions: freezeArray(agent.permissions),
    dependsOn: freezeArray(agent.dependsOn),
    handoffsTo: freezeArray(agent.handoffsTo),
    handoffs: freezeArray(agent.handoffs),
    ticketTypes: freezeArray(agent.ticketTypes),
  });
}

export function createAgentRegistry(options) {
  return new AgentRegistry(options);
}

export default AgentRegistry;
