/**
 * Portable skill selector for @agentos/runtime.
 *
 * This module never invokes a skill's handler directly. A host must provide
 * an authorization decision and an executor owned by AgentRuntime. This keeps
 * the skill package from becoming a competing production execution loop.
 */

function assertSkill(skill) {
  if (!skill || typeof skill !== 'object' || typeof skill.name !== 'string' || !skill.name.trim()) {
    throw new TypeError('skill must be an object with a non-empty name');
  }
}

export function createSkillRuntime({ skills = [], authorize, execute } = {}) {
  if (!Array.isArray(skills)) throw new TypeError('skills must be an array');
  if (typeof authorize !== 'function') {
    throw new TypeError('authorize is required; skill execution must fail closed');
  }
  if (typeof execute !== 'function') {
    throw new TypeError('execute is required; delegate execution to the host AgentRuntime');
  }

  const registered = [];

  function use(skill) {
    assertSkill(skill);
    if (registered.some((item) => item.name === skill.name)) {
      throw new Error(`skill already registered: ${skill.name}`);
    }
    registered.push(skill);
    return api;
  }

  for (const skill of skills) use(skill);

  async function run(input, context = {}) {
    if (input === undefined || input === null) throw new TypeError('input is required');
    if (context == null || typeof context !== 'object' || Array.isArray(context)) {
      throw new TypeError('context must be an object');
    }

    for (const skill of registered) {
      if (typeof skill.match !== 'function') continue;
      const match = await skill.match(input, context);
      if (!match) continue;
      if (typeof match.tool !== 'string' || !match.tool.trim()) {
        throw new TypeError(`skill ${skill.name} returned a match without a tool name`);
      }
      const tool = (skill.tools || []).find((item) => item?.name === match.tool);
      if (!tool || typeof tool.handler !== 'function') {
        throw new Error(`skill ${skill.name} matched unknown tool ${match.tool}`);
      }
      const args = match.args && typeof match.args === 'object' && !Array.isArray(match.args)
        ? match.args
        : {};

      let decision;
      try {
        decision = await authorize({ skill, tool, args, context, input });
      } catch {
        return { ok: false, reason: 'authorization_error', skill: skill.name, tool: tool.name };
      }
      if (!decision || decision.allowed !== true) {
        return {
          ok: false,
          reason: decision?.reason || 'denied',
          skill: skill.name,
          tool: tool.name,
        };
      }

      // The host executor must route through the canonical AgentRuntime and its
      // task, tenant, permission, approval, and audit boundaries.
      const result = await execute({ skill, tool, args, context, input, authorization: decision });
      return { ok: true, skill: skill.name, tool: tool.name, result };
    }

    return { ok: false, reason: 'no_match' };
  }

  const api = {
    use,
    run,
    list() {
      return registered.map((skill) => skill.name);
    },
  };
  return api;
}
