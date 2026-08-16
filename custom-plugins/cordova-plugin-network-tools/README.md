# AgentOS Network Tools Cordova Plugin

This plugin exposes the platform-local portion of AgentOS network tools to Cordova applications. It follows the same `plugin.xml`, `www/`, and native bridge layout as the repository’s other custom Cordova plugins.

## JavaScript API

```js
const networkTools = window.AgentOSNetworkTools;

const capabilities = await networkTools.capabilities();
const connectivity = await networkTools.connectivity();
const interfaces = await networkTools.interfaces();
```

`execute(tool, params, context)` is available for application integrations, but native implementations intentionally reject server-side AgentOS tool execution. Router, firewall, diagnostics, and other privileged operations must be sent through the authenticated AgentOS gateway and the `network-tools` skill, where identity, permissions, approval, provider selection, and audit logging are enforced.

The native bridge provides local capabilities, connectivity state, and interface inventory on Android and iOS. The web fallback returns a structured unsupported response rather than pretending native telemetry is available.

## Security boundary

The plugin does not embed router credentials, open arbitrary remote URLs, or bypass AgentOS authorization. Device-control requests remain server-side and must use the gateway’s authenticated transport.
