# AgentOS VSCode Extension

Control AgentOS fleet directly from VSCode.

## Setup
1. `Cmd+,` → search "AgentOS" → set Gateway URL + API Token
2. Or run `AgentOS: Set Gateway Config` from Command Palette

## Commands
- `Ctrl+Alt+A`: Run any skill
- `Ctrl+Alt+R`: Generate UI Recorder for current URL
- `AgentOS: Onboard All Routers`: Shard config to fleet
- `AgentOS: Brand Hotspots`: Push portal to all routers
- `AgentOS: Memory Dump`: Open memory in editor

## Workflow
1. `AgentOS: Generate UI Recorder` → enter `https://router.local`
2. Copy JS → paste in browser console → click through login
3. Copy JSON output → paste in VSCode → `AgentOS: Run UI Agent on URL`
4. AgentOS runs it headlessly and returns screenshots

## Install
1. `cd extensions/vscode-agentos`
2. `npm install -g @vscode/vsce`
3. `vsce package`
4. `code --install-extension agentos-vscode-1.0.0.vsix`
