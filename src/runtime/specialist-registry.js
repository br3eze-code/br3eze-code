/**
 * Specialist registry: identity and capability metadata for executable role-bound work.
 * Skills and tools remain reusable; this registry supplies the specialist boundary.
 */
export class SpecialistRegistry {
  constructor() {
    this.specialists = new Map();
  }

  register(definition = {}) {
    const role = String(definition.role || definition.id || '').trim().toLowerCase();
    if (!role) throw new Error('specialist role is required');
    const id = String(definition.id || `${role}-specialist`).trim().toLowerCase();
    if (this.specialists.has(role) || [...this.specialists.values()].some((item) => item.id === id)) throw new Error(`Specialist "${role}" already registered`);
    const specialist = Object.freeze({
      id,
      role,
      name: definition.name || definition.label || role,
      label: definition.label || definition.name || role,
      domain: definition.domain || 'general',
      description: definition.description || '',
      skills: Object.freeze([...(definition.skills || definition.skillNames || [])]),
      tools: Object.freeze([...(definition.tools || [])]),
      permissions: Object.freeze([...(definition.permissions || [])]),
      dependsOn: Object.freeze([...(definition.dependsOn || [])]),
      handoffsTo: Object.freeze([...(definition.handoffsTo || definition.handoffs || [])]),
      skillNames: Object.freeze([...(definition.skillNames || definition.skills || [])]),
      ticketTypes: Object.freeze([...(definition.ticketTypes || [])]),
      handoffs: Object.freeze([...(definition.handoffs || definition.handoffsTo || [])]),
    });
    this.specialists.set(role, specialist);
    this.specialists.set(id, specialist);
    return specialist;
  }

  get(role) {
    return this.specialists.get(String(role || '').trim().toLowerCase()) || null;
  }

  list() {
    return [...new Map([...this.specialists.values()].map((item) => [item.id, item])).values()];
  }

  canHandle(role, ticketType) {
    const specialist = this.get(role);
    return Boolean(specialist && (!specialist.ticketTypes.length || specialist.ticketTypes.includes(ticketType)));
  }
}

export default SpecialistRegistry;
