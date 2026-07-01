'use strict';
/**
 * auth.js — thin shim that delegates to UserSandbox.
 * Kept for backward compatibility with src/core/agent.js and other callers
 * that require('./auth'). New code should require('./userSandbox') directly.
 */
const { UserSandbox, getUserSandbox, AuthError, anyMatch } = require('./userSandbox');
const { audit } = require('./audit');

async function authorize({ userId, tool, args, routerId }) {
  const sandbox = getUserSandbox();
  const toolName = typeof tool === 'string' ? tool : tool?.name;

  const can = await sandbox.canUse(userId, toolName);
  if (!can) {
    await audit.log({ userId, tool: toolName, status: 'DENIED', reason: 'RBAC: tool not allowed' });
    throw new AuthError(`Your role cannot run ${toolName}`, 'TOOL_NOT_ALLOWED');
  }

  const needs = await sandbox.needsApproval(userId, toolName);
  if (needs) {
    const req = await sandbox.requestApproval({ userId, toolName: toolName, args, routerId });
    await audit.log({ userId, tool: toolName, status: 'PENDING_APPROVAL', approvalId: req.id });
    return { status: 'needs_approval', approvalId: req.id };
  }

  sandbox.checkRateLimit(userId, toolName);
  await audit.log({ userId, tool: toolName, status: 'ALLOWED' });
  return { status: 'ok' };
}

module.exports = { AuthError, authorize, getUserSandbox, UserSandbox };
