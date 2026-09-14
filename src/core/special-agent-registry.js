/**
 * Canonical special-agent registry.
 * Profiles are policy metadata only; they never grant permissions.
 */
import {
  PROFILE_DEFINITIONS,
  getAgentRoleProfile,
  normalizeAgentRole,
  resolveAgentRole,
  isApprovalRequired
} from './agent-role-profiles.js';

export class SpecialAgentRegistry {
  constructor(profiles = PROFILE_DEFINITIONS) { this.profiles = profiles; }

  has(role) {
    const normalized = normalizeAgentRole(role);
    return Boolean(normalized && this.profiles[normalized]);
  }

  resolve(input = {}) {
    const role = resolveAgentRole(input) || normalizeAgentRole(input);
    return role ? this.get(role) : null;
  }

  get(role) {
    const normalized = normalizeAgentRole(role);
    return normalized && this.profiles[normalized] ? getAgentRoleProfile(normalized) : null;
  }

  list() { return Object.keys(this.profiles).map(role => this.get(role)); }
  capabilities(role) { return this.get(role)?.capabilities || []; }
  approvalRequired(role, action) { return isApprovalRequired(role, action); }
  canPropose(role, capability) { return this.capabilities(role).includes(capability); }
}

export function createSpecialAgentRegistry(profiles) { return new SpecialAgentRegistry(profiles); }
export const specialAgentRegistry = new SpecialAgentRegistry();
export default specialAgentRegistry;
