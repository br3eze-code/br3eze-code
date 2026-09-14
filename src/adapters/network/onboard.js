import fs from 'node:fs/promises';
import path from 'node:path';
import { getManager } from './mikrotik.js';
import { logger } from '../../core/logger.js';

/** Concrete network onboarding adapter. Core only receives these capabilities through registration. */
export function templateRsc(content, extra = {}) {
  const vars = { ...process.env, ...extra, TELEGRAM_BOT_TOKEN: extra.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN };
  return String(content).replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => vars[key] === undefined ? match : String(vars[key]));
}

export function generateSetupScript(config = {}) {
  const nodeUrl = config.AGENTOS_NODE_URL || process.env.AGENTOS_NODE_URL || 'http://localhost:3000';
  const identity = config.name || config.id || 'Node';
  return [
    `/system identity set name="AgentOS-${String(identity).replace(/"/g, '')}"`,
    '/ip service set telnet disabled=yes',
    '/ip service set ftp disabled=yes',
    '/ip service set api-ssl disabled=no',
    `/system note set show-at-login=no note="AgentOS node: ${nodeUrl.replace(/"/g, '')}"`
  ].join('\n') + '\n';
}

async function loadTemplate(name, options = {}) {
  try {
    return templateRsc(await fs.readFile(path.join(process.cwd(), name), 'utf8'), options);
  } catch {
    return name === 'setup.rsc' ? generateSetupScript(options) : null;
  }
}

export async function onboardRouter(options = {}) {
  const manager = getManager(options);
  try {
    if (!await manager.connect()) throw new Error('Unable to connect to network device');
    if (options.dryRun) return { success: true, dryRun: true, message: 'Onboarding plan validated' };
    const script = await loadTemplate('setup.rsc', options);
    if (script && manager.conn) {
      await manager.conn.write(['/system/script/add', `=name=agentos_setup_${Date.now()}`, `=source=${script}`]);
    }
    return { success: true, message: 'Network device onboarding completed' };
  } catch (error) {
    logger.error(`Network onboarding failed: ${error.message}`);
    return { success: false, error: error.message };
  } finally {
    await manager.disconnect().catch(() => {});
  }
}

export async function onboardFleet(target, options = {}) {
  const inventoryPath = options.inventoryPath || path.join(process.cwd(), 'knowledge', 'inventory.json');
  let inventory;
  try { inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8')); }
  catch (error) { return { success: false, error: `Inventory not found: ${error.message}` }; }
  const targets = target === 'all' ? inventory : inventory.filter(node => node.id === target || node.name === target || node.role === String(target).replace(/^role:/, ''));
  const results = [];
  for (const node of targets) results.push({ id: node.id, ...(await onboardRouter({ ...options, ...node })) });
  return { success: results.some(result => result.success), total: results.length, results };
}

export async function provisionAgents() { return { success: false, error: 'Agent provisioning is now owned by the agent/plugin orchestration layer' }; }
export async function generateMissionControl(results = []) { return { generated: false, results }; }
export async function runWizard() { throw new Error('Use the host onboarding command to collect configuration, then call onboardRouter()'); }

export default { templateRsc, generateSetupScript, onboardRouter, onboardFleet, provisionAgents, generateMissionControl, runWizard };
