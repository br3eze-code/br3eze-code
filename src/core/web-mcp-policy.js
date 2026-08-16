const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (PRIVATE_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  return false;
}

export function validateWebMcpRequest({ url, method = 'GET', allowedHosts = [], allowHttp = false, approval = null } = {}) {
  const errors = [];
  let parsed;
  try { parsed = new URL(url); } catch { return { allowed: false, errors: ['invalid_url'] }; }
  const normalizedMethod = String(method).toUpperCase();
  if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(parsed.protocol)) errors.push('insecure_protocol');
  if (isPrivateHostname(parsed.hostname)) errors.push('private_network_blocked');
  if (allowedHosts.length && !allowedHosts.includes(parsed.hostname)) errors.push('host_not_allowlisted');
  if (MUTATING_METHODS.has(normalizedMethod) && approval?.approved !== true) errors.push('explicit_approval_required');
  if (parsed.username || parsed.password) errors.push('embedded_credentials_blocked');
  return { allowed: errors.length === 0, errors, url: parsed.toString(), method: normalizedMethod };
}

export function sanitizeWebMcpObservation(value, { maxChars = 12000 } = {}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return text
    .replace(/(?:authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*[^\n;]+/gi, '$1: [REDACTED]')
    .replace(/(?:api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, maxChars);
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

export { PRIVATE_HOSTS, MUTATING_METHODS };
export default { validateWebMcpRequest, sanitizeWebMcpObservation, webMcpActionManifest };
