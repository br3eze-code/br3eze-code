#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { planReconciliation } from '../../src/core/infrastructure/reconciliation.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const probe = args.includes('--probe');
const json = args.includes('--json');
const observedAt = args.indexOf('--observed');
const observedPath = observedAt >= 0 ? args[observedAt + 1] : null;
if (observedAt >= 0 && (!observedPath || observedPath.startsWith('--'))) throw new Error('Expected a path after --observed');

const load = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const has = (name) => Boolean(process.env[name]);
const commandProbe = (command, commandArgs) => {
  const result = spawnSync(command, commandArgs, { cwd: root, env: process.env, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, shell: false });
  if (result.error?.code === 'ENOENT') return { status: 'cli_missing' };
  if (result.error) return { status: 'probe_error', reason: result.error.code || 'execution_error' };
  return result.status === 0 ? { status: 'reachable' } : { status: 'not_authenticated_or_failed', exitCode: result.status };
};
const apiProbe = async (url, headers) => {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    return response.ok ? { status: 'reachable', httpStatus: response.status } : { status: 'remote_rejected', httpStatus: response.status };
  } catch (error) { return { status: 'probe_error', reason: error.name === 'TimeoutError' ? 'timeout' : 'network_error' }; }
};
const probeProvider = async (provider) => {
  switch (provider.id) {
    case 'aws':
      if (!has('AWS_PROFILE') && !has('AWS_ACCESS_KEY_ID') && !has('AWS_WEB_IDENTITY_TOKEN_FILE')) return { status: 'credentials_missing' };
      return commandProbe('aws', ['sts', 'get-caller-identity', '--output', 'json']);
    case 'firebase':
      if (!has('FIREBASE_SERVICE_ACCOUNT') && !has('GOOGLE_APPLICATION_CREDENTIALS')) return { status: 'credentials_missing' };
      return commandProbe('firebase', ['projects:list', '--json']);
    case 'supabase':
      if (!has('SUPABASE_ACCESS_TOKEN')) return { status: 'credentials_missing' };
      return commandProbe('supabase', ['projects', 'list', '--output', 'json']);
    case 'vercel':
      if (!has('VERCEL_TOKEN')) return { status: 'credentials_missing' };
      return commandProbe('vercel', ['whoami']);
    case 'cloudflare':
      if (!has('CLOUDFLARE_API_TOKEN')) return { status: 'credentials_missing' };
      return commandProbe('wrangler', ['whoami']);
    case 'google':
      if (!has('GOOGLE_APPLICATION_CREDENTIALS') && !has('GOOGLE_CLOUD_PROJECT') && !has('CLOUDSDK_AUTH_ACCESS_TOKEN')) return { status: 'credentials_missing' };
      return commandProbe('gcloud', ['projects', 'list', '--format=json']);
    case 'openai':
      return has('OPENAI_API_KEY') ? apiProbe('https://api.openai.com/v1/models', { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY }) : { status: 'credentials_missing' };
    case 'anthropic':
      return has('ANTHROPIC_API_KEY') ? apiProbe('https://api.anthropic.com/v1/models', { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }) : { status: 'credentials_missing' };
    default: return { status: 'unsupported' };
  }
};

const [providerConfig, desiredState] = await Promise.all([load('infra/providers.json'), load('infra/desired-state.json')]);
const providerStatus = [];
for (const provider of providerConfig.providers) {
  const configured = provider.env.some(has);
  providerStatus.push({ id: provider.id, name: provider.name, configured, credentialVariablesPresent: provider.env.filter(has).length, credentialVariablesExpected: provider.env.length, ...(probe ? await probeProvider(provider) : { status: configured ? 'credentials_present_not_probed' : 'not_configured' }) });
}
let plan = null;
let comparisonStatus = 'not_compared_remote_inventory_required';
if (observedPath) {
  const inventory = JSON.parse(await readFile(path.resolve(root, observedPath), 'utf8'));
  if (!Array.isArray(inventory.resources)) throw new TypeError('Observed inventory file must contain a resources array');
  plan = planReconciliation({ desired: desiredState.resources, observed: inventory.resources });
  comparisonStatus = 'compared';
}
const report = { sourceOfTruth: providerConfig.sourceOfTruth, mode: 'read-only', comparisonStatus, providerStatus, desiredResourceCount: desiredState.resources.length, plan };
if (json) console.log(JSON.stringify(report, null, 2));
else {
  console.log('AgentOS infrastructure reconciliation — READ ONLY');
  console.log('Desired source: ' + report.sourceOfTruth);
  for (const item of providerStatus) console.log('  ' + item.id.padEnd(12) + ' ' + item.status + ' (' + item.credentialVariablesPresent + '/' + item.credentialVariablesExpected + ' credential variables present)');
  console.log('Desired resources: ' + report.desiredResourceCount);
  console.log('Remote comparison: ' + comparisonStatus);
  if (plan) console.log('Plan: ' + JSON.stringify(plan.counts) + '; no remote writes performed.');
}
