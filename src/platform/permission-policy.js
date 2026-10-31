/**
 * Small default-deny capability policy. This is an authorization decision
 * layer, not an OS sandbox; host adapters must enforce the decision at use time.
 */
export class PermissionPolicy {
  #grants = new Map();

  grant(principal, capabilities = []) {
    this.#validatePrincipal(principal);
    if (!Array.isArray(capabilities) || capabilities.some((cap) => typeof cap !== 'string' || !cap.trim())) {
      throw new TypeError('capabilities must be non-empty strings');
    }
    this.#grants.set(principal, new Set(capabilities));
    return this.list(principal);
  }

  revoke(principal, capability) {
    this.#validatePrincipal(principal);
    if (capability === undefined) return this.#grants.delete(principal);
    return this.#grants.get(principal)?.delete(capability) ?? false;
  }

  check(principal, capability) {
    if (typeof principal !== 'string' || !principal || typeof capability !== 'string' || !capability) {
      return { allowed: false, reason: 'invalid-principal-or-capability' };
    }
    const allowed = this.#grants.get(principal)?.has(capability) === true;
    return { allowed, reason: allowed ? 'granted' : 'capability-not-granted' };
  }

  assert(principal, capability) {
    const result = this.check(principal, capability);
    if (!result.allowed) {
      const error = new Error(`Permission denied: ${principal} requires ${capability}`);
      error.name = 'PermissionDeniedError';
      error.code = 'PERMISSION_DENIED';
      throw error;
    }
    return true;
  }

  list(principal) {
    this.#validatePrincipal(principal);
    return [...(this.#grants.get(principal) || [])].sort();
  }

  #validatePrincipal(principal) {
    if (typeof principal !== 'string' || !principal.trim()) throw new TypeError('principal must be a non-empty string');
  }
}
