// src/permissions.js — permission modes and enforcement
// Mirrors the smartcomputer-ai PermissionMode / PermissionEnforcer pattern
const PermissionMode = Object.freeze({ AUTO: 'auto', PROMPT: 'prompt', DENY: 'deny' });

class PermissionDenial extends Error {
  constructor(toolName, reason = 'Permission denied') {
    super(`${toolName}: ${reason}`);
    this.toolName = toolName;
    this.reason = reason;
    this.name = 'PermissionDenial';
  }
}

class PermissionEnforcer {
  constructor(mode = PermissionMode.PROMPT) { this.mode = mode; }
  async check(toolName, risk = 'low') {
    if (this.mode === PermissionMode.DENY)  throw new PermissionDenial(toolName, 'all tools denied');
    if (this.mode === PermissionMode.AUTO)  return true;
    if (risk === 'low')                     return true;
    return true; // PROMPT mode: in production, emit an approval event
  }
}
export { PermissionMode, PermissionEnforcer, PermissionDenial };
