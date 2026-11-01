import net from 'node:net';

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPrivateIpv4(host) {
  if (net.isIP(host) !== 4) return false;
  const octets = host.split('.').map(Number);
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224;
}

function isPrivateHostname(hostname) {
  let host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (PRIVATE_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;

  // WHATWG URL parsing canonicalizes many non-decimal IPv4 spellings before
  // this function is called. Explicitly reject IP literals that are not safe.
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) return isPrivateIpv4(host);
  if (ipVersion === 6) {
    // Conservative default: disallow IPv6 literals here until the HTTP
    // transport can validate the resolved destination address at connect time.
    // This prevents loopback, link-local, unique-local and mapped-address bypasses.
    return true;
  }
  if (/^[0-9.]+$/.test(host)) return true;
  return false;
}

export function validateWebMcpRequest({ url, method = 'GET', allowedHosts = [], allowHttp = false, approval = null } = {}) {
  const errors = [];
  let parsed;
  try { parsed = new URL(url); } catch { return { allowed: false, errors: ['invalid_url'] }; }

  const normalizedMethod = String(method).toUpperCase();
  if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(parsed.protocol)) errors.push('insecure_protocol');
  if (isPrivateHostname(parsed.hostname)) errors.push('private_network_blocked');
  if (parsed.hostname && parsed.hostname.includes('%')) errors.push('encoded_hostname_blocked');

  const normalizedAllowedHosts = allowedHosts.map((host) => String(host).toLowerCase().replace(/\.$/, ''));
  if (normalizedAllowedHosts.length && !normalizedAllowedHosts.includes(parsed.hostname.toLowerCase().replace(/\.$/, ''))) {
    errors.push('host_not_allowlisted');
  }
  if (MUTATING_METHODS.has(normalizedMethod) && approval?.approved !== true) errors.push('explicit_approval_required');
  if (parsed.username || parsed.password) errors.push('embedded_credentials_blocked');

  // Important: this synchronous policy cannot prevent DNS rebinding by itself.
  // The caller must resolve the hostname, reject private/reserved destination
  // IPs, and pin the validated address for the actual outbound connection.
  return { allowed: errors.length === 0, errors, url: parsed.toString(), method: normalizedMethod };
}

export function sanitizeWebMcpObservation(value, { maxChars = 12000 } = {}) {
  const sensitiveKey = /(?:authorization|proxy.?authorization|cookie|set.?cookie|api.?key|token|secret|password|credential|private.?key|session)/i;
  const seen = new WeakSet();
  const scrub = (input, depth = 0) => {
    if (typeof input === 'string') {
      return input
        .replace(/((?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*)[^\n;]+/gi, '$1[REDACTED]')
        .replace(/((?:api[_-]?key|token|secret|password|credential)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
    }
    if (input === null || typeof input !== 'object') return input;
    if (depth > 12) return '[TRUNCATED]';
    if (seen.has(input)) return '[CIRCULAR]';
    seen.add(input);
    if (Array.isArray(input)) return input.map((item) => scrub(item, depth + 1));
    return Object.fromEntries(Object.entries(input).map(([key, child]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : scrub(child, depth + 1),
    ]));
  };
  let text;
  try {
    const safe = scrub(value ?? '');
    text = typeof safe === 'string' ? safe : JSON.stringify(safe);
  } catch {
    text = '[unserializable observation]';
  }
  return text.slice(0, Math.max(0, maxChars));
}

export function webMcpActionManifest({ readOnly = true } = {}) {
  return Object.freeze({
    observe: { method: 'GET', requiresApproval: false },
    navigate: { method: 'GET', requiresApproval: false },
    submit: { method: 'POST', requiresApproval: true, enabled: !readOnly },
    update: { method: 'PATCH', requiresApproval: true, enabled: !readOnly },
    delete: { method: 'DELETE', requiresApproval: true, enabled: !readOnly },
  });
}

export { PRIVATE_HOSTS, MUTATING_METHODS, isPrivateHostname };
export default { validateWebMcpRequest, sanitizeWebMcpObservation, webMcpActionManifest };
