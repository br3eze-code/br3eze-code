/**
 * Organisation Matrix
 *
 * Domain-neutral assignment engine. It resolves work to an eligible
 * specialist by capability, authority, capacity and scope. Execution is
 * deliberately delegated to the selected specialist; this module never
 * reaches an external provider and never bypasses policy or audit.
 */

export class OrganisationMatrix {
  constructor({ policy, audit, clock = () => new Date() } = {}) {
    this.policy = policy ?? { authorize: async () => true };
    this.audit = audit ?? { record: async () => undefined };
    this.clock = clock;
    this.specialists = new Map();
  }

  register(specialist) {
    if (!specialist?.id) throw new TypeError('specialist.id is required');
    if (!Array.isArray(specialist.capabilities)) throw new TypeError('specialist.capabilities must be an array');
    this.specialists.set(specialist.id, {
      capacity: 1,
      active: 0,
      authority: [],
      scope: [],
      ...specialist,
    });
    return this.specialists.get(specialist.id);
  }

  unregister(id) {
    return this.specialists.delete(id);
  }

  list() {
    return [...this.specialists.values()].map(({ execute, ...specialist }) => ({ ...specialist }));
  }

  eligible(work) {
    return [...this.specialists.values()].filter((specialist) =>
      this.#matchesCapability(specialist, work) &&
      this.#matchesAuthority(specialist, work) &&
      this.#matchesScope(specialist, work) &&
      specialist.active < specialist.capacity,
    );
  }

  async assign(work, context = {}) {
    if (!work?.id) throw new TypeError('work.id is required');
    const candidates = this.eligible(work);
    const ranked = candidates
      .map((specialist) => ({ specialist, score: this.#score(specialist, work) }))
      .sort((a, b) => b.score - a.score);

    for (const { specialist, score } of ranked) {
      const decision = await this.policy.authorize({ action: 'assign', work, specialist, context });
      if (decision === false || decision?.allowed === false) continue;

      specialist.active += 1;
      const assignment = {
        id: `${work.id}:${specialist.id}:${this.clock().getTime()}`,
        workId: work.id,
        specialistId: specialist.id,
        score,
        assignedAt: this.clock().toISOString(),
      };
      await this.audit.record({ type: 'assignment.created', assignment, work, context });
      return assignment;
    }

    await this.audit.record({ type: 'assignment.rejected', work, context });
    return null;
  }

  async release(assignment, outcome = {}) {
    const specialist = this.specialists.get(assignment?.specialistId);
    if (specialist) specialist.active = Math.max(0, specialist.active - 1);
    await this.audit.record({ type: 'assignment.released', assignment, outcome });
    return assignment;
  }

  async execute(assignment, work, context = {}) {
    const specialist = this.specialists.get(assignment?.specialistId);
    if (!specialist?.execute) throw new Error('Assigned specialist has no execute capability');

    const decision = await this.policy.authorize({ action: 'execute', work, specialist, context });
    if (decision === false || decision?.allowed === false) {
      await this.release(assignment, { status: 'denied' });
      throw new Error('Execution denied by policy');
    }

    try {
      const result = await specialist.execute({ work, assignment, context });
      await this.audit.record({ type: 'assignment.completed', assignment, work, result, context });
      return result;
    } catch (error) {
      await this.audit.record({ type: 'assignment.failed', assignment, work, error: { name: error.name, message: error.message }, context });
      throw error;
    } finally {
      await this.release(assignment, { status: 'finished' });
    }
  }

  #matchesCapability(specialist, work) {
    const required = work.capability;
    return !required || specialist.capabilities.includes(required);
  }

  #matchesAuthority(specialist, work) {
    const required = work.authority;
    return !required || specialist.authority.includes(required);
  }

  #matchesScope(specialist, work) {
    const required = work.scope;
    return !required || specialist.scope.length === 0 || specialist.scope.includes(required);
  }

  #score(specialist, work) {
    let score = 0;
    if (work.capability && specialist.capabilities.includes(work.capability)) score += 100;
    if (work.authority && specialist.authority.includes(work.authority)) score += 50;
    if (work.scope && specialist.scope.includes(work.scope)) score += 25;
    score += Math.max(0, specialist.capacity - specialist.active);
    return score;
  }
}

export default OrganisationMatrix;
