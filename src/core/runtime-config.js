import fs from 'node:fs';
import { getConfig } from './config.js';

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '') ?? '';
}

function numberValue(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boolValue(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (TRUE.has(normalized)) return true;
  if (FALSE.has(normalized)) return false;
  return fallback;
}

function listValue(value, fallback = []) {
  if (Array.isArray(value)) return value.map(String).map(item => item.trim()).filter(Boolean);
  if (value == null || value === '') return fallback;
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function nested(source, section, key) {
  return source?.[section]?.[key];
}

function loadOptionalJson(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid AgentOS config JSON at ${filePath}: ${error.message}`);
  }
}

export function resolveRuntimeConfig({ env = process.env, config = null } = {}) {
  const configFile = env.AGENTOS_CONFIG_FILE || env.AGENTOS_CONFIG_PATH;
  const fileConfig = loadOptionalJson(configFile);
  const base = config || getConfig();
  const merged = { ...base, ...fileConfig };

  const value = (section, key, envKeys = []) => firstDefined(...envKeys.map(name => env[name]), nested(merged, section, key));

  return Object.freeze({
    environment: String(firstDefined(env.AGENTOS_ENV, merged.environment, 'development')),
    public: Object.freeze({
      apiBaseUrl: String(firstDefined(env.AGENTOS_API_BASE_URL, env.AGENTOS_GATEWAY_URL, nested(merged, 'public', 'apiBaseUrl'), '')),
      dashboardUrl: String(firstDefined(env.AGENTOS_DASHBOARD_URL, nested(merged, 'public', 'dashboardUrl'), '')),
      serviceName: String(firstDefined(env.BRAND_SERVICE_NAME, nested(merged, 'public', 'serviceName'), merged.name, 'AgentOS'))
    }),
    onboarding: Object.freeze({
      pairingTtlMs: numberValue(value('onboarding', 'pairingTtlMs', ['AGENTOS_ONBOARDING_PAIRING_TTL_MS']), 600000, { min: 1000 }),
      wbsEnabled: boolValue(value('onboarding', 'wbsEnabled', ['AGENTOS_ONBOARDING_WBS_ENABLED']), true),
      defaultChannel: String(firstDefined(value('onboarding', 'defaultChannel', ['AGENTOS_ONBOARDING_DEFAULT_CHANNEL']), 'telegram')),
      defaultSpecialistId: String(firstDefined(value('onboarding', 'defaultSpecialistId', ['AGENTOS_ONBOARDING_SPECIALIST_ID']), '')),
      sessionStore: String(firstDefined(value('onboarding', 'sessionStore', ['AGENTOS_ONBOARDING_SESSION_STORE']), 'memory'))
    }),
    storyline: Object.freeze({
      basePath: String(firstDefined(value('storyline', 'basePath', ['AGENTOS_STORYLINE_BASE_PATH']), '')),
      sessionTtlMs: numberValue(value('storyline', 'sessionTtlMs', ['AGENTOS_STORYLINE_SESSION_TTL_MS']), 86400000, { min: 1000 }),
      maxCacheEntries: numberValue(value('storyline', 'maxCacheEntries', ['AGENTOS_STORYLINE_MAX_CACHE_ENTRIES']), 100, { min: 1 }),
      compactKeepLast: numberValue(value('storyline', 'compactKeepLast', ['AGENTOS_STORYLINE_COMPACT_KEEP_LAST']), 20, { min: 1 }),
      defaultMode: String(firstDefined(value('storyline', 'defaultMode', ['AGENTOS_STORYLINE_MODE']), 'isolated')),
      summaryMaxChars: numberValue(value('storyline', 'summaryMaxChars', ['AGENTOS_STORYLINE_SUMMARY_MAX_CHARS']), 50, { min: 1 }),
      systemSummaryLabel: String(firstDefined(value('storyline', 'systemSummaryLabel', ['AGENTOS_STORYLINE_SUMMARY_LABEL']), 'Previous conversation summary'))
    }),
    api: Object.freeze({
      version: String(firstDefined(env.AGENTOS_API_VERSION, nested(merged, 'api', 'version'), 'v1')),
      basePath: String(firstDefined(env.AGENTOS_API_BASE_PATH, nested(merged, 'api', 'basePath'), '/api/v1')),
      requireAuth: boolValue(firstDefined(env.AGENTOS_API_REQUIRE_AUTH, nested(merged, 'api', 'requireAuth')), true)
    }),
    firebase: Object.freeze({
      apiKey: String(firstDefined(env.FIREBASE_WEB_API_KEY, env.FIREBASE_API_KEY, nested(merged, 'firebase', 'apiKey'), '')),
      authDomain: String(firstDefined(env.FIREBASE_AUTH_DOMAIN, nested(merged, 'firebase', 'authDomain'), '')),
      databaseURL: String(firstDefined(env.FIREBASE_DATABASE_URL, nested(merged, 'firebase', 'databaseURL'), '')),
      projectId: String(firstDefined(env.FIREBASE_PROJECT_ID, nested(merged, 'firebase', 'projectId'), '')),
      storageBucket: String(firstDefined(env.FIREBASE_STORAGE_BUCKET, nested(merged, 'firebase', 'storageBucket'), '')),
      messagingSenderId: String(firstDefined(env.FIREBASE_MESSAGING_SENDER_ID, nested(merged, 'firebase', 'messagingSenderId'), '')),
      appId: String(firstDefined(env.FIREBASE_APP_ID, nested(merged, 'firebase', 'appId'), '')),
      measurementId: String(firstDefined(env.FIREBASE_MEASUREMENT_ID, nested(merged, 'firebase', 'measurementId'), ''))
    })
  });
}

export function validateRuntimeConfig(runtime, { requireApi = false, requireFirebase = false } = {}) {
  const errors = [];
  if (requireApi && !runtime.public.apiBaseUrl) errors.push('AGENTOS_API_BASE_URL or AGENTOS_GATEWAY_URL');
  if (requireFirebase) {
    for (const [key, value] of Object.entries(runtime.firebase)) {
      if (!value) errors.push(`FIREBASE_${key.replace(/[A-Z]/g, match => `_${match}`).toUpperCase()}`);
    }
  }
  if (errors.length) throw new Error(`Invalid AgentOS runtime configuration; missing: ${errors.join(', ')}`);
  return runtime;
}

export function readFrontendRuntimeConfig(globalObject = globalThis) {
  const env = globalObject?.ENV || {};
  return resolveRuntimeConfig({ env, config: { public: env, firebase: env } });
}

export default resolveRuntimeConfig;
