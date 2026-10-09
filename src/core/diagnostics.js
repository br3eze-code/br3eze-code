import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getTaskRegistry, TaskStatus } from './taskRegistry.js';
import { getAgentRuntime } from './agentRuntime.js';
import { listSessions } from './sessionStore.js';
import { logger } from './logger.js';

export const DiagnosticHealth = Object.freeze({ HEALTHY: 'healthy', DEGRADED: 'degraded', OFFLINE: 'offline' });
const writable = dir => { try { fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, '.write-test'); fs.writeFileSync(f, 'ok'); fs.unlinkSync(f); return true; } catch { return false; } };
export const isSystemReady = snapshot => snapshot?.diagnostics?.stateWritable === true && snapshot?.diagnostics?.sessionStoreWritable === true;
export const isMissionReady = snapshot => isSystemReady(snapshot) && snapshot?.diagnostics?.runtimeReady === true;
export const isRouterReady = () => false;

export async function buildGatewayDiagnostics({ healthChecks = [] } = {}) {
  const stateWritable = writable(path.join(os.homedir(), '.agentos', 'state'));
  const sessionStoreWritable = writable(path.join(os.homedir(), '.agentos', 'state', 'sessions'));
  const checks = await Promise.all(healthChecks.map(async check => { try { return { id: check.id, ok: await check.run() }; } catch (error) { return { id: check.id, ok: false, error: error.message }; } }));
  const issues = []; if (!stateWritable) issues.push('State directory is not writable'); if (!sessionStoreWritable) issues.push('Session store is not writable'); if (checks.some(c => !c.ok)) issues.push('One or more registered health checks failed');
  return { installed: true, loaded: true, rpcOk: checks.every(c => c.ok), runtimeReady: true, stateWritable, sessionStoreWritable, checks, issues, securityWarnings: [] };
}

export async function buildMissionControlSnapshot(options = {}) {
  const diagnostics = await buildGatewayDiagnostics(options);
  const registry = getTaskRegistry(); const runtime = getAgentRuntime();
  const tasks = registry.list(); const summary = registry.summary();
  const records = tasks.map(t => ({ id: t.taskId, key: t.taskId.slice(0, 8), title: t.description || t.prompt?.slice(0, 60), mission: t.prompt, status: t.status, updatedAt: t.updatedAt, ageMs: Date.now() - t.createdAt, updateCount: t.messages?.length || 0 }));
  return { generatedAt: new Date().toISOString(), mode: diagnostics.issues.length ? 'degraded' : 'ready', diagnostics, runtimes: records.filter(t => t.status === TaskStatus.RUNNING), tasks: records, taskSummary: summary, agentRuntime: { permissionMode: runtime.defaultConfig.permissionMode, maxTurns: runtime.defaultConfig.maxTurns, toolCount: runtime.listTools().length }, systemReady: isSystemReady({ diagnostics }), missionReady: isMissionReady({ diagnostics }) };
}

export async function handleHealthFull(req, res) { try { const diag = await buildGatewayDiagnostics(); const health = diag.issues.length ? DiagnosticHealth.DEGRADED : DiagnosticHealth.HEALTHY; res.status(200).json({ health, ok: true, ...diag }); } catch (error) { logger.error(`Health check failed: ${error.message}`); res.status(500).json({ health: DiagnosticHealth.OFFLINE, ok: false, error: error.message }); } }
export async function handleSnapshot(req, res) { try { res.json(await buildMissionControlSnapshot()); } catch (error) { logger.error(`Snapshot failed: ${error.message}`); res.status(500).json({ error: error.message, mode: 'fallback' }); } }
export { listSessions };
