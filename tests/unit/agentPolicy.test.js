'use strict';
/**
 * Note: agentPolicy.js also defines an `AgentPolicy` class (wrapping a
 * `PolicyEngine` from ./policy) but never exports it, and nothing else in
 * the repo requires it — it's dead code. It's also broken: PolicyEngine's
 * constructor does `config.policies`, but AgentPolicy calls
 * `new PolicyEngine()` with no argument, so instantiating it would throw
 * "Cannot read properties of undefined (reading 'policies')". Since it's
 * unreachable from outside the module, there's nothing to usefully test —
 * these tests cover the actually-exported preset/policy-check API instead.
 *
 * Also documents a second, live bug: AgentPreset.BROWSER is enumerated but
 * PRESET_POLICIES has no 'browser' entry, so resolveAgentPolicy('browser')
 * silently falls back to the WORKER policy — see the dedicated test below.
 */

const {
  AgentPreset,
  MissingToolBehavior,
  InstallScope,
  FileAccess,
  NetworkAccess,
  resolveAgentPolicy,
  checkPolicyForTool,
  inferPresetFromDescription,
  resolveHeartbeat,
  heartbeatIntervalMs,
  PRESET_POLICIES,
  HEARTBEAT_INTERVALS,
  DEFAULT_HEARTBEAT_INTERVAL,
} = require('../../src/core/agentPolicy');

describe('resolveAgentPolicy', () => {
  test('returns the WORKER preset by default', () => {
    expect(resolveAgentPolicy().preset).toBe(AgentPreset.WORKER);
  });

  test.each(Object.values(AgentPreset).filter(p => p !== AgentPreset.BROWSER))(
    'resolves the %s preset by name',
    preset => {
      expect(resolveAgentPolicy(preset).preset).toBe(preset);
    }
  );

  test('BUG: AgentPreset.BROWSER is enumerated but PRESET_POLICIES has no entry for it, ' +
    'so it silently resolves to the WORKER policy instead of a browser-appropriate one', () => {
    expect(PRESET_POLICIES[AgentPreset.BROWSER]).toBeUndefined();
    expect(resolveAgentPolicy(AgentPreset.BROWSER).preset).toBe(AgentPreset.WORKER);
  });

  test('falls back to WORKER for an unknown preset name', () => {
    expect(resolveAgentPolicy('not-a-real-preset').preset).toBe(AgentPreset.WORKER);
  });

  test('returns a shallow copy, not the shared PRESET_POLICIES object', () => {
    const policy = resolveAgentPolicy(AgentPreset.WORKER);
    policy.label = 'mutated';
    expect(PRESET_POLICIES[AgentPreset.WORKER].label).not.toBe('mutated');
  });
});

describe('checkPolicyForTool', () => {
  test('MONITORING preset only allows tools in its own read-only list', () => {
    const policy = resolveAgentPolicy(AgentPreset.MONITORING);
    expect(checkPolicyForTool(policy, 'system.stats')).toEqual({ allowed: true });
    expect(checkPolicyForTool(policy, 'user.kick')).toMatchObject({ allowed: false });
  });

  test('networkAccess=restricted blocks destructive network tools', () => {
    const policy = resolveAgentPolicy(AgentPreset.WORKER); // RESTRICTED
    expect(checkPolicyForTool(policy, 'firewall.block')).toMatchObject({ allowed: false });
    expect(checkPolicyForTool(policy, 'system.reboot')).toMatchObject({ allowed: false });
  });

  test('networkAccess=enabled permits destructive network tools (SETUP preset)', () => {
    const policy = resolveAgentPolicy(AgentPreset.SETUP); // ENABLED
    expect(checkPolicyForTool(policy, 'firewall.block')).toEqual({ allowed: true });
  });

  test('installScope=none blocks router-mutating tools (MONITORING preset)', () => {
    const policy = resolveAgentPolicy(AgentPreset.MONITORING);
    expect(checkPolicyForTool(policy, 'user.add')).toMatchObject({ allowed: false });
  });

  test('installScope beyond none permits mutating tools that are otherwise allowed (WORKER preset)', () => {
    const policy = resolveAgentPolicy(AgentPreset.WORKER);
    expect(checkPolicyForTool(policy, 'user.add')).toEqual({ allowed: true });
  });

  test('fileAccess=workspace-only blocks tools needing extended router access', () => {
    const policy = resolveAgentPolicy(AgentPreset.WORKER); // WORKSPACE_ONLY
    expect(checkPolicyForTool(policy, 'interface.list')).toMatchObject({ allowed: false });
    expect(checkPolicyForTool(policy, 'arp.table')).toMatchObject({ allowed: false });
  });

  test('fileAccess=extended permits those tools (SETUP preset)', () => {
    const policy = resolveAgentPolicy(AgentPreset.SETUP); // EXTENDED
    expect(checkPolicyForTool(policy, 'interface.list')).toEqual({ allowed: true });
  });

  test('a completely unrestricted tool is allowed under any preset', () => {
    const policy = resolveAgentPolicy(AgentPreset.WORKER);
    expect(checkPolicyForTool(policy, 'ping')).toEqual({ allowed: true });
  });
});

describe('inferPresetFromDescription', () => {
  test.each([
    ['Provision a new router for the branch office', AgentPreset.SETUP],
    ['Bootstrap and configure the hotspot', AgentPreset.SETUP],
    ['Monitor router health and alert on downtime', AgentPreset.MONITORING],
    ['Poll uptime every 5 minutes', AgentPreset.MONITORING],
    ['Handle day-to-day voucher and user operations', AgentPreset.WORKER],
    ['', AgentPreset.WORKER],
  ])('%s -> %s', (description, expected) => {
    expect(inferPresetFromDescription(description)).toBe(expected);
  });

  test('defaults to WORKER when called with no argument', () => {
    expect(inferPresetFromDescription()).toBe(AgentPreset.WORKER);
  });
});

describe('resolveHeartbeat', () => {
  test('MONITORING preset defaults to enabled, others default to disabled', () => {
    expect(resolveHeartbeat(AgentPreset.MONITORING)).toEqual({
      enabled: true,
      every: DEFAULT_HEARTBEAT_INTERVAL,
    });
    expect(resolveHeartbeat(AgentPreset.WORKER)).toEqual({
      enabled: false,
      every: DEFAULT_HEARTBEAT_INTERVAL,
    });
  });

  test('an explicit heartbeatConfig overrides the preset default', () => {
    expect(resolveHeartbeat(AgentPreset.WORKER, { enabled: true, every: '15m' })).toEqual({
      enabled: true,
      every: '15m',
    });
  });

  test('a partial heartbeatConfig only overrides the fields it sets', () => {
    expect(resolveHeartbeat(AgentPreset.MONITORING, { every: '60m' })).toEqual({
      enabled: true,
      every: '60m',
    });
    expect(resolveHeartbeat(AgentPreset.MONITORING, { enabled: false })).toEqual({
      enabled: false,
      every: DEFAULT_HEARTBEAT_INTERVAL,
    });
  });
});

describe('heartbeatIntervalMs', () => {
  test.each(Object.entries(HEARTBEAT_INTERVALS))('%s resolves to %d ms', (key, ms) => {
    expect(heartbeatIntervalMs(key)).toBe(ms);
  });

  test('falls back to the default interval for an unknown key', () => {
    expect(heartbeatIntervalMs('not-a-real-interval')).toBe(
      HEARTBEAT_INTERVALS[DEFAULT_HEARTBEAT_INTERVAL]
    );
  });

  test('defaults to the default interval when called with no argument', () => {
    expect(heartbeatIntervalMs()).toBe(HEARTBEAT_INTERVALS[DEFAULT_HEARTBEAT_INTERVAL]);
  });
});

describe('enums are frozen', () => {
  test.each([
    ['AgentPreset', AgentPreset],
    ['MissingToolBehavior', MissingToolBehavior],
    ['InstallScope', InstallScope],
    ['FileAccess', FileAccess],
    ['NetworkAccess', NetworkAccess],
  ])('%s cannot be mutated at runtime', (_name, enumObj) => {
    expect(Object.isFrozen(enumObj)).toBe(true);
  });
});
