/**
 * Runtime-scoped observations of the external world.
 *
 * Observations are volatile by design: after restart, unknown state remains unknown
 * until re-observed. This registry is not an authorization system and does not
 * itself make device actions safe; callers must enforce freshness before acting.
 */
const DEFAULT_MAX_AGE_MS = 30_000;
const MAX_FUTURE_SKEW_MS = 5_000;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,191}$/;

function assertIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new TypeError(`${label} must be a non-empty identifier (max 192 characters)`);
  }
}

function clone(value) {
  return structuredClone(value);
}

export class WorldStateRegistry {
  constructor({ clock = () => Date.now(), defaultMaxAgeMs = DEFAULT_MAX_AGE_MS, maxObservations = 10_000 } = {}) {
    if (typeof clock !== 'function') throw new TypeError('clock must be a function');
    if (!Number.isSafeInteger(defaultMaxAgeMs) || defaultMaxAgeMs < 1) {
      throw new RangeError('defaultMaxAgeMs must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxObservations) || maxObservations < 1) {
      throw new RangeError('maxObservations must be a positive safe integer');
    }
    this.clock = clock;
    this.defaultMaxAgeMs = defaultMaxAgeMs;
    this.maxObservations = maxObservations;
    this.observations = new Map();
    this.versions = new Map();
  }

  record({ resourceId, key, value, source, observedAt = new Date(this.clock()).toISOString(), confidence = 1, maxAgeMs = this.defaultMaxAgeMs } = {}) {
    assertIdentifier(resourceId, 'resourceId');
    assertIdentifier(key, 'key');
    assertIdentifier(source, 'source');
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new RangeError('confidence must be a number between 0 and 1');
    }
    if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1) {
      throw new RangeError('maxAgeMs must be a positive safe integer');
    }
    const observedTime = Date.parse(observedAt);
    if (typeof observedAt !== 'string' || !Number.isFinite(observedTime)) {
      throw new TypeError('observedAt must be a valid ISO date string');
    }
    const now = this.clock();
    if (observedTime > now + MAX_FUTURE_SKEW_MS) {
      throw new RangeError('observation timestamp is too far in the future');
    }

    const id = `${resourceId}\u0000${key}`;
    if (!this.observations.has(id) && this.observations.size >= this.maxObservations) {
      throw new Error('world-state observation limit reached');
    }
    const version = (this.versions.get(id) || 0) + 1;
    const observation = {
      resourceId,
      key,
      value: clone(value),
      source,
      confidence,
      observedAt: new Date(observedTime).toISOString(),
      recordedAt: new Date(now).toISOString(),
      maxAgeMs,
      version,
    };
    this.versions.set(id, version);
    this.observations.set(id, observation);
    return this.#present(observation, now);
  }

  get(resourceId, key, { maxAgeMs } = {}) {
    assertIdentifier(resourceId, 'resourceId');
    assertIdentifier(key, 'key');
    const observation = this.observations.get(`${resourceId}\u0000${key}`);
    if (!observation) return { resourceId, key, status: 'unknown', value: null, reason: 'never_observed' };
    if (maxAgeMs !== undefined && (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1)) {
      throw new RangeError('maxAgeMs must be a positive safe integer');
    }
    return this.#present(observation, this.clock(), maxAgeMs);
  }

  requireFresh(resourceId, key, options = {}) {
    const result = this.get(resourceId, key, options);
    if (result.status !== 'current') {
      const error = new Error(`world-state observation is ${result.status}: ${resourceId}/${key}`);
      error.code = 'WORLD_STATE_NOT_CURRENT';
      error.observation = result;
      throw error;
    }
    return result;
  }

  snapshot(resourceId, options = {}) {
    assertIdentifier(resourceId, 'resourceId');
    const now = this.clock();
    return [...this.observations.values()]
      .filter((observation) => observation.resourceId === resourceId)
      .map((observation) => this.#present(observation, now, options.maxAgeMs));
  }

  clear(resourceId, key) {
    assertIdentifier(resourceId, 'resourceId');
    if (key !== undefined) {
      assertIdentifier(key, 'key');
      return this.observations.delete(`${resourceId}\u0000${key}`);
    }
    let removed = false;
    for (const [id, observation] of this.observations) {
      if (observation.resourceId === resourceId) {
        this.observations.delete(id);
        removed = true;
      }
    }
    return removed;
  }

  #present(observation, now, overrideMaxAgeMs) {
    const maxAgeMs = overrideMaxAgeMs ?? observation.maxAgeMs;
    const ageMs = Math.max(0, now - Date.parse(observation.observedAt));
    return {
      ...clone(observation),
      status: ageMs <= maxAgeMs ? 'current' : 'stale',
      ageMs,
      effectiveMaxAgeMs: maxAgeMs,
      reason: ageMs <= maxAgeMs ? null : 'observation_expired',
    };
  }
}

export default WorldStateRegistry;
