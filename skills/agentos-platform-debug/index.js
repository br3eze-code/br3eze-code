export const role = 'platform-debug';
export const createContext = ({ userId, tenantId, platform = null, repository = null, commitSha = null, issueId = null } = {}) => {
  if (!userId || !tenantId) throw new TypeError('userId and tenantId are required');
  return Object.freeze({
    userId: String(userId),
    tenantId: String(tenantId),
    agentRole: role,
    skillPackage: 'agentos-platform-debug',
    platform: platform ? String(platform) : null,
    repository: repository ? String(repository) : null,
    commitSha: commitSha ? String(commitSha) : null,
    issueId: issueId ? String(issueId) : null,
    approvalRequired: true,
  });
};
export const specialist = Object.freeze({
  role,
  kind: 'platform-diagnostics',
  approvalRequired: true,
  createContext,
});
export default specialist;
