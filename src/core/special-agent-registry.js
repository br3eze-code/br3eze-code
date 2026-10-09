/**
 * Backward-compatible profile registry.
 *
 * Canonical identity/capability storage lives in AgentRegistry. This class
 * preserves the legacy SpecialAgentRegistry API for existing callers.
 */
import { AgentRegistry } from './agent-registry.js';
import {
  PROFILE_DEFINITIONS,
  normalizeAgentRole,
  resolveAgentRole,
  isApprovalRequired
} from './agent-role-profiles.js';

export class SpecialAgentRegistry {
  constructor(profiles = PROFILE_DEFINITIONS) {
    this.registry = new AgentRegistry();
    for (const [role, profile] of Object.entries(profiles || {})) {
      this.registry.register({ role, ...profile });
    }
    this.profiles = profiles;
  }

  has(role) {
    return this.registry.has(normalizeAgentRole(role));
  }

  resolve(input = {}) {
    const role = resolveAgentRole(input) || normalizeAgentRole(input);
    return role ? this.get(role) : null;
  }

  get(role) {
    const agent = this.registry.get(normalizeAgentRole(role));
    if (!agent) return null;
    return {
      role: agent.role,
      label: agent.label,
      description: agent.description,
      capabilities: [...agent.capabilities],
      approvalRequired: [...agent.approvalRequired],
      domains: [...agent.domains],
      defaultNextAction: agent.defaultNextAction,
    };
  }

  list() {
    return this.registry.list().map((agent) => this.get(agent.role));
  }

  capabilities(role) {
    return this.registry.capabilities(normalizeAgentRole(role));
  }

  approvalRequired(role, action) {
    return isApprovalRequired(role, action);
  }

  canPropose(role, capability) {
    return this.registry.canPropose(normalizeAgentRole(role), capability);
  }
}

export function createSpecialAgentRegistry(profiles) {
  return new SpecialAgentRegistry(profiles);
}

export const specialAgentRegistry = new SpecialAgentRegistry();
export default specialAgentRegistry;
