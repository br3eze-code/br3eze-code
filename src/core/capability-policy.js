/**
 * Provider-neutral capability authorization.
 *
 * Policies should grant capabilities such as `network.write` or
 * `surveillance.read`; adapters may continue exposing legacy provider tool
 * names. This keeps policy independent from MikroTik, Dahua, Starlink, or any
 * other vendor implementation.
 */

const CAPABILITY_PATTERNS = Object.freeze({
  'network.read': ['network.read', 'network.*', 'mikrotik.ping', 'mikrotik.users', 'mikrotik.system.stats', 'mikrotik.json'],
  'network.write': ['network.write', 'network.firewall.*', 'network.ip.routes', 'mikrotik.user.*', 'mikrotik.firewall.*', 'mikrotik.system.reboot', 'mikrotik.system.reset'],
  'surveillance.read': ['cctv.stream', 'cctv.stream.credentials', 'cctv.stream.multi', 'device.channels', 'device.discover', 'device.health', 'device.info', 'device.list', 'dahua.device.*', 'dahua.events.*', 'dahua.scene.describe', 'dahua.snapshot.get', 'dahua.stream.url'],
  'surveillance.write': ['device.command', 'dahua.ptz.*', 'dahua.system.reboot'],
  'fleet.read': ['fleet.read', 'starlink.*', 'device.health', 'device.info', 'device.list'],
  'fleet.write': ['fleet.write', 'device.command', 'starlink.*'],
  'identity.manage': ['user.*', 'users.*', 'agentos.channels.status'],
  'commerce.read': ['shop.list_*', 'shop.get_*', 'shop.view_cart', 'shop.list_reviews', 'shop.related_products', 'voucher.list'],
  'commerce.write': ['shop.add_to_cart', 'shop.remove_from_cart', 'shop.clear_cart', 'shop.checkout', 'voucher.create', 'voucher.redeem'],
  'commerce.admin': ['shop.create_shipment', 'shop.track_shipment', 'shop.submit_review', 'billing.*', 'payment.*'],
  'system.read': ['system.stats', 'system.health', 'system.info', 'system.identity', 'system.logs', 'system.audit', 'system.doctor'],
  'system.write': ['system.reboot', 'system.shutdown', 'system.backup', 'system.file.*'],
});

function patternMatches(pattern, toolName) {
  if (pattern === '*' || pattern === toolName) return true;
  if (pattern.endsWith('*')) return toolName.startsWith(pattern.slice(0, -1));
  return false;
}

function capabilityMatches(capability, toolName) {
  return (CAPABILITY_PATTERNS[capability] || []).some((pattern) => patternMatches(pattern, toolName));
}

function anyCapabilityMatches(patterns = [], toolName) {
  return patterns.some((pattern) => capabilityMatches(pattern, toolName));
}

export { CAPABILITY_PATTERNS, capabilityMatches, anyCapabilityMatches };
export default { CAPABILITY_PATTERNS, capabilityMatches, anyCapabilityMatches };

