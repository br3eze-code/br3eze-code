/**
 * Build the capability surface exposed to a client channel.
 *
 * The manifest is descriptive for all clients, but executable tool names are
 * filtered by the caller's role/capabilities so UI discovery cannot become an
 * authorization bypass. Provider-specific tools remain implementation details.
 */
import { anyCapabilityMatches } from './capability-policy.js';

export const CLIENT_CAPABILITIES = Object.freeze([
  'assistant.use',
  'research.read',
  'device.discovery',
  'network.read',
  'network.write',
  'surveillance.read',
  'surveillance.write',
  'fleet.read',
  'fleet.write',
  'identity.manage',
  'commerce.read',
  'commerce.write',
  'commerce.admin',
  'system.read',
  'system.write',
]);

const ADMIN_ROLES = new Set(['admin', 'owner', 'super_admin', 'platform_admin']);

function normalizeList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

export function buildCapabilityManifest({
  user = null,
  availableTools = [],
  platform = 'cordova',
  channel = 'rest',
  bridges = {},
} = {}) {
  const role = user?.role || 'anonymous';
  const granted = normalizeList(user?.capabilities || user?.permissions);
  const elevated = ADMIN_ROLES.has(role);
  const tools = normalizeList(availableTools);
  const executableTools = elevated
    ? tools
    : tools.filter((tool) => anyCapabilityMatches(granted, tool));

  return {
    version: 1,
    platform,
    channel,
    role,
    authenticated: Boolean(user?.uid || user?.id),
    capabilities: CLIENT_CAPABILITIES.filter((capability) => elevated || granted.includes(capability)),
    tools: executableTools,
    toolCount: executableTools.length,
    restrictedToolCount: Math.max(0, tools.length - executableTools.length),
    bridges: {
      aiCore: Boolean(bridges.aiCore),
      networkTools: Boolean(bridges.networkTools),
      connectivity: Boolean(bridges.connectivity),
      websocket: Boolean(bridges.websocket),
    },
  };
}

export default buildCapabilityManifest;

if (typeof module !== 'undefined') module.exports = { buildCapabilityManifest, CLIENT_CAPABILITIES };
