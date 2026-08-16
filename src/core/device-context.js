const DEVICE_FIELDS = Object.freeze([
  'platform',
  'model',
  'osVersion',
  'appVersion',
  'browser',
  'locale',
  'timezone',
  'networkType',
  'isVirtual',
]);

function cleanString(value, max = 160) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

/**
 * Normalize device metadata captured by a trusted platform bridge.
 * Device metadata is descriptive only: it never establishes user identity,
 * tenant scope, location permission, or tool authorization.
 */
export function normalizeDeviceInfo(input = {}, fallback = {}) {
  const source = {
    ...(fallback.deviceInfo || {}),
    ...(input.deviceInfo || input.device || {}),
  };
  const result = {};
  for (const field of DEVICE_FIELDS) {
    const value = field === 'model'
      ? source.model ?? source.deviceModel
      : source[field];
    if (field === 'isVirtual') {
      if (value !== undefined && value !== null) result[field] = Boolean(value);
    } else {
      const cleaned = cleanString(value);
      if (cleaned) result[field] = cleaned;
    }
  }
  const deviceId = cleanString(source.deviceId || source.installationId, 128);
  if (deviceId) result.deviceId = deviceId;
  const capturedAt = cleanString(source.capturedAt || source.timestamp, 64);
  if (capturedAt) result.capturedAt = capturedAt;
  return Object.freeze(result);
}

export default { normalizeDeviceInfo };
