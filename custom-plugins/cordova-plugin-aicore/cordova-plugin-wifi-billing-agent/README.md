# WiFi Billing Agent Plugin

A comprehensive Cordova plugin that provides a complete WiFi billing system with multi-agent architecture, gossip protocols for mesh networking, and AI orchestration.

## Features

### Core Capabilities

- **Multi-Agent System**: Core, WiFi, Billing, Auth, Notification, and AI Orchestrator agents
- **Gossip Protocol**: Distributed state synchronization across devices
- **Mesh Networking**: Peer-to-peer communication via WebRTC and Bluetooth
- **AI Orchestration**: Natural language intent processing and autonomous action execution
- **Session Management**: Time and data-based billing with automatic renewal
- **Background Operation**: Foreground services for persistent session monitoring

### Billing Features

- Time-based billing (per minute)
- Data usage tracking with limits
- Automatic session renewal
- Grace periods and warnings
- Cost calculation and payment processing

### Network Features

- Android 10+ modern WiFi APIs (NetworkSpecifier, NetworkSuggestion)
- Legacy Android support (WiFiConfiguration)
- iOS HotspotConfiguration support
- Automatic reconnection and roaming
- Signal quality monitoring

### Security & Auth

- JWT token-based authentication
- Automatic token refresh
- Device profiling
- Session validation

## Installation

```bash
cordova plugin add cordova-plugin-wifi-billing-agent
```
