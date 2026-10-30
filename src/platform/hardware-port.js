const REQUIRED_METRICS = ['platform', 'architecture', 'cpuCount', 'totalMemoryBytes'];

export function validateHardwareProvider(provider) {
  if (!provider || typeof provider.probe !== 'function') throw new TypeError('hardware provider must implement probe()');
  return provider;
}

/**
 * Portable hardware-information port. Platform-specific code belongs in
 * adapters; the core only consumes a normalized, best-effort profile.
 */
export class HardwarePort {
  #provider;

  constructor(provider) { this.#provider = validateHardwareProvider(provider); }

  async profile({ signal } = {}) {
    if (signal?.aborted) throw signal.reason ?? new Error('Hardware probe aborted');
    const raw = await this.#provider.probe({ signal });
    if (signal?.aborted) throw signal.reason ?? new Error('Hardware probe aborted');
    if (!raw || typeof raw !== 'object') throw new TypeError('hardware provider returned an invalid profile');
    const profile = {
      platform: String(raw.platform || 'unknown'),
      architecture: String(raw.architecture || 'unknown'),
      cpuCount: Number.isSafeInteger(raw.cpuCount) && raw.cpuCount > 0 ? raw.cpuCount : null,
      totalMemoryBytes: Number.isSafeInteger(raw.totalMemoryBytes) && raw.totalMemoryBytes >= 0 ? raw.totalMemoryBytes : null,
      accelerators: Array.isArray(raw.accelerators) ? raw.accelerators.filter((x) => typeof x === 'string') : [],
      features: Array.isArray(raw.features) ? raw.features.filter((x) => typeof x === 'string') : [],
      source: String(raw.source || this.#provider.id || 'adapter'),
    };
    // Unknown values are permitted: some runtimes cannot inspect host hardware.
    return Object.freeze(profile);
  }
}

export const HARDWARE_PROFILE_FIELDS = Object.freeze([...REQUIRED_METRICS]);
