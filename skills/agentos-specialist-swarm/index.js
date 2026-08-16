/**
 * AgentOS specialist-swarm specialist skill entry point.
 * The index is metadata and an execution-context factory; policy still validates every action.
 */
export const specialist = Object.freeze({
  role: 'specialist-swarm',
  kind: 'coordination',
  approvalRequired: Object.freeze(["role.assign","handoff.commit"]),
  createContext(input = {}) {
    const required = ['userId', 'tenantId'];
    const missing = required.filter((key) => !input[key]);
    if (missing.length) throw new Error(`Missing specialist context: ${missing.join(', ')}`);
    return Object.freeze({
      ...input,
      agentRole: 'specialist-swarm',
      skillPackage: 'specialist-swarm',
      approvalRequired: [...specialist.approvalRequired]
    });
  }
});

export const role = specialist.role;
export const createContext = specialist.createContext;
export default specialist;
