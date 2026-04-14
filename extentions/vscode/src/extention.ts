import * as vscode from 'vscode';
import { AgentOSAPI } from './api';
import { SkillsProvider } from './skillsView';
import { RecorderPanel } from './recorderPanel';

let outputChannel: vscode.OutputChannel;
let api: AgentOSAPI;

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("AgentOS");
  api = new AgentOSAPI(outputChannel);

  context.subscriptions.push(
    vscode.commands.registerCommand('agentos.setConfig', () => api.setConfig()),
    vscode.commands.registerCommand('agentos.runSkill', () => runSkill()),
    vscode.commands.registerCommand('agentos.memory', () => runMemory()),
    vscode.commands.registerCommand('agentos.onboardAll', () => runQuickSkill('/api/onboard', { target: 'all' })),
    vscode.commands.registerCommand('agentos.hotspotBrand', () => runQuickSkill('/api/hotspot-brand', { target: 'all' })),
    vscode.commands.registerCommand('agentos.recordUi', () => recordUi()),
    vscode.commands.registerCommand('agentos.runUiAgent', () => runUiAgent())
  );

  const skillsProvider = new SkillsProvider();
  vscode.window.registerTreeDataProvider('agentos-skills', skillsProvider);

  outputChannel.appendLine('AgentOS extension activated');
}

async function runSkill() {
  const skill = await vscode.window.showQuickPick([
    { label: 'onboard', description: 'Shard config to routers' },
    { label: 'hotspot-brand', description: 'Deploy portal to fleet' },
    { label: 'memory', description: 'Dump knowledge files' },
    { label: 'rollback', description: 'List/restore backups' },
    { label: 'freeze', description: 'Freeze/unfreeze agent' },
    { label: 'ui-agent', description: 'Run browser automation' },
    { label: 'ui-record', description: 'Generate UI recorder' }
  ], { placeHolder: 'Select AgentOS skill' });
  if (!skill) return;

  let params: Record<string, string> = {};
  if (['onboard', 'hotspot-brand'].includes(skill.label)) {
    const target = await vscode.window.showInputBox({ prompt: 'Target', value: 'all' });
    if (target) params.target = target;
  }
  if (skill.label === 'ui-agent') {
    const url = await vscode.window.showInputBox({ prompt: 'URL to automate' });
    if (!url) return;
    const actions = await vscode.window.showInputBox({ prompt: 'Actions JSON', value: '[]' });
    if (!actions) return;
    params.url = url; params.actions = actions;
  }
  if (skill.label === 'ui-record') {
    const url = await vscode.window.showInputBox({ prompt: 'URL to record on', value: 'https://' });
    if (!url) return;
    params.url = url;
  }

  const res = await api.call(`/api/${skill.label}`, params);
  if (res) vscode.window.showInformationMessage(res.message?.slice(0, 200) || 'Done');
}

async function runQuickSkill(endpoint: string, params: Record<string, string>) {
  const res = await api.call(endpoint, params);
  if (res) vscode.window.showInformationMessage(res.message?.slice(0, 200) || 'Done');
}

async function runMemory() {
  const res = await api.call('/api/memory');
  if (res) {
    const doc = await vscode.workspace.openTextDocument({ content: res.message, language: 'markdown' });
    vscode.window.showTextDocument(doc);
  }
}

async function recordUi() {
  const url = await vscode.window.showInputBox({ prompt: 'URL to record on', value: 'https://' });
  if (!url) return;
  const res = await api.call('/api/ui-record', { url });
  if (res?.recorder_code) {
    RecorderPanel.createOrShow(context.extensionUri, res.recorder_code, url);
  }
}

async function runUiAgent() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return vscode.window.showErrorMessage('Open a file with actions JSON');
  let actions: any[];
  try { actions = JSON.parse(editor.document.getText()); } 
  catch { return vscode.window.showErrorMessage('Invalid JSON in active editor'); }
  const url = await vscode.window.showInputBox({ prompt: 'Target URL' });
  if (!url) return;
  const res = await api.call('/api/ui-agent', { url, actions: JSON.stringify(actions) });
  if (res) {
    vscode.window.showInformationMessage(res.message);
    if (res.screenshots?.length) {
      outputChannel.appendLine(`Screenshots: ${res.screenshots.join(', ')}`);
      outputChannel.show();
    }
  }
}

export function deactivate() {}
