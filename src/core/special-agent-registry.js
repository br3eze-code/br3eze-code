/**
 * Canonical special-agent registry.
 *
 * Profiles are policy metadata only. This registry resolves the professional
 * specialist requested by a task and exposes its capabilities/approval hints;
 * it never grants permissions and never imports a domain/provider adapter.
 */
import { getAgentRoleProfile, normalizeAgentRole, resolveAgentRole, PROFILE_DEFINITIONS } from './agent-role-profiles.js';

export class SpecialAgentRegistry {
  constructor(profiles = PROFILE_DEFINITIONS) {
    this.profiles = profiles;
  }

  has(role) { return Boolean(normalizeAgentRole(role) && this.profiles[normalizeAgentRole(role)]); }

  resolve(input = {}) {
    const role = resolveAgentRole(input) || normalizeAgentRole(input);
    return role ? this.get(role) : null;
  }

  get(role) {
    const normalized = normalizeAgentRole(role);
    return normalized && this.profiles[normalized] ? getAgentRoleProfile(normalized) : null;
  }

  list() {
    return Object.keys(this.profiles).map(role => this.get(role));
  }

  capabilities(role) {
    return this.get(role)?.capabilities || [];
  }

  approvalRequired(role, action) {
    const profile = this.get(role);
    if (!profile || typeof action !== 'string') return false;
    return profile.approvalRequired.some(required => action === required || action.startsWith(`${required}.`) || action.startsWith(`${required}:`));
  }

  canPropose(role, capability) {
    return this.capabilities(role).includes(capability);
  }
}

export function createSpecialAgentRegistry(profiles) {
  return new SpecialAgentRegistry(profiles);
}

export const specialAgentRegistry = new SpecialAgentRegistry();

export default specialAgentRegistry;
