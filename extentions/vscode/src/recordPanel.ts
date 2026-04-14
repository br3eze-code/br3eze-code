import * as vscode from 'vscode';

export class RecorderPanel {
  public static currentPanel: RecorderPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri, code: string, url: string) {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;
    if (RecorderPanel.currentPanel) {
      RecorderPanel.currentPanel._panel.reveal(column);
      RecorderPanel.currentPanel._update(code, url);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'agentosRecorder', 'AgentOS UI Recorder', column, { enableScripts: true }
    );
    RecorderPanel.currentPanel = new RecorderPanel(panel, extensionUri, code, url);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, code: string, url: string) {
    this._panel = panel;
    this._update(code, url);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  private _update(code: string, url: string) {
    this._panel.webview.html = this._getHtml(code, url);
  }

  private _getHtml(code: string, url: string): string {
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>body{font-family:system-ui;background:#0f172a;color:#fff;padding:20px}pre{background:#1e293b;padding:12px;border-radius:6px;overflow:auto;font-size:12px}button{background:#3b82f6;color:#fff;border:none;padding:10px 16px;border-radius:6px;cursor:pointer;margin:8px 4px 8px 0}button:hover{background:#2563eb}h3{margin-top:0}.step{background:#1e293b;padding:12px;border-radius:6px;margin:12px 0}</style>
</head><body>
<h3>🔴 UI Recorder for ${url}</h3>
<div class="step"><b>Step 1:</b> Go to <code>${url}</code></div>
<div class="step"><b>Step 2:</b> Open DevTools Console (F12) and paste this code:
<pre id="code">${code.replace(/</g, '&lt;')}</pre>
<button onclick="copyCode()">Copy Code</button></div>
<div class="step"><b>Step 3:</b> Click through your workflow. Each click is recorded.</div>
<div class="step"><b>Step 4:</b> Click "Finish & Copy JSON" in the panel that appears on the page.</div>
<div class="step"><b>Step 5:</b> Paste the JSON here → <code>Cmd+Alt+A</code> → ui-agent</div>
<script>function copyCode(){navigator.clipboard.writeText(document.getElementById('code').textContent);event.target.textContent='Copied!';}</script>
</body></html>`;
  }

  public dispose() {
    RecorderPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) { const x = this._disposables.pop(); if (x) x.dispose(); }
  }
}
