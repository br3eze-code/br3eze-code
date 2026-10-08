/**
 * Backward-compatible specialist registry.
 *
 * Canonical identity/capability storage lives in AgentRegistry. Specialist
 * definitions remain domain bundles; this adapter preserves the old API.
 */
import { AgentRegistry } from '../core/agent-registry.js';

export class SpecialistRegistry {
  constructor() {
    this.registry = new AgentRegistry();
    this.specialists = this.registry.agents;
  }

  register(definition = {}) {
    return this.registry.register(definition);
  }

  get(role) {
    return this.registry.get(role);
  }

  list() {
    return this.registry.list();
  }

  canHandle(role, ticketType) {
    return this.registry.canHandle(role, ticketType);
  }
}

export default SpecialistRegistry;
