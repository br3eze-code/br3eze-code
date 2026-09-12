# AgentOS Network Adapter Suite 2.1.0

Portable network/Wi-Fi adapter suite for AgentOS. The core contract is domain-agnostic; platform and vendor implementations stay behind adapters.

## Layout

- `packages/agentos-network-adapter/` — adapter contract and tool descriptors
- `apps/wifi-manager-desktop/` — Electron Windows/macOS/Linux desktop application
- `plugins/cordova-plugin-wifi-manager/` — mobile Cordova implementation
- `docs/` — AgentOS integration notes
- `tests/` — contract tests

The desktop application is an Electron shell over native OS Wi-Fi commands. It does not claim identical OS capabilities: unsupported operations return structured capability errors.
