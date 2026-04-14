import * as vscode from 'vscode';

export class SkillsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
  
  getChildren(): vscode.TreeItem[] {
    return [
      { label: 'onboard all', cmd: 'onboard' },
      { label: 'hotspot-brand all', cmd: 'hotspot-brand' },
      { label: 'memory', cmd: 'memory' },
      { label: 'ui-record', cmd: 'ui-record' },
      { label: 'ui-agent', cmd: 'ui-agent' },
      { label: 'rollback list', cmd: 'rollback' }
    ].map(s => {
      const item = new vscode.TreeItem(s.label, vscode.TreeItemCollapsibleState.None);
      item.command = { command: 'agentos.runSkill', title: s.label, arguments: [s.cmd] };
      item.iconPath = new vscode.ThemeIcon('play');
      return item;
    });
  }
}
