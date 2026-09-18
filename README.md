<div align="center">
<pre>
█████╗  ██████╗ ███████╗███╗   ██╗████████╗ ██████╗ ███████╗
██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔═══██╗██╔════╝
███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██║   ██║███████╗
██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██║   ██║╚════██║
██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ╚██████╔╝███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚══════╝
</pre>
</div>

<p align="center">
  <img src="https://img.shields.io/badge/AgentOS-2026.5.4-blue?style=for-the-badge&logo=router&logoColor=white" alt="Version">
  <img src="https://img.shields.io/badge/MikroTik-RouterOS-green?style=for-the-badge&logo=mikrotik" alt="MikroTik">
  <img src="https://img.shields.io/badge/AI-Gemini%202.5-orange?style=for-the-badge&logo=google" alt="AI">
</p>

# 🤖 AgentOS

Network Intelligence Platform — AI-powered MikroTik management via Telegram, WhatsApp & CLI

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#documentation">Docs</a> •
  <a href="#demo">Demo</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## ✨ Why AgentOS?

Managing MikroTik routers shouldn't require memorizing CLI commands or keeping WinBox open 24/7. AgentOS brings conversational AI to network administration — control your infrastructure from messaging apps or the CLI.

## The Problem AgentOS Solves

Managing community WiFi infrastructure across multiple MikroTik nodes can be tedious: WinBox requires a desktop, RouterOS CLI requires memorizing commands, and hotspot billing often needs manual voucher generation. AgentOS consolidates these tasks into one intelligent agent you control from Telegram, WhatsApp, or a WebSocket CLI.

---

## 🚀 Features

- 🤖 AI Coordinator — Natural language router management via Gemini 2.5 (ReAct engine)
- 💬 Multi-channel control — Telegram, WhatsApp, WebSocket CLI, and REST API
- 🎫 Voucher system with payment integrations and QR code generation
- 🌐 Multi-router mesh management, monitoring, and automated alerts
- 🔒 Security — command allowlist, rate limiting, input validation, and audit trails
- 🧰 Tools — ping, traceroute, firewall management, user management, and more

---

## 📦 Installation

```bash
# Install from npm (optional global installer)
npm install -g br3eze-code

# Or clone repository
git clone https://github.com/br3eze-code/br3eze-code.git
cd br3eze-code

# Install dependencies
npm install

# Interactive setup
npm run onboard

# Or manual configuration
cp .env.example .env
# Edit a private environment file with only the features you use.
# Never commit .env or place server secrets in browser code.
```

Environment variables (minimal examples):

```env
# MikroTik
MIKROTIK_HOST=192.168.88.1
MIKROTIK_USER=admin
MIKROTIK_PASS=your_password
MIKROTIK_PORT=8728

# Telegram
TELEGRAM_TOKEN=your_bot_token
TELEGRAM_ADMIN_CHAT_ID=your_chat_id

# AI
GEMINI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Payments (Mastercard A2A)
MC_CONSUMER_KEY=your_key
MC_PRIVATE_KEY_PATH=./certs/sandbox.p12

# Database
FIREBASE_PROJECT_ID=your_project
# Or leave blank for local JSON fallback
```

## 🎮 Quick Start

### Prerequisites

- Node.js 20+ (ESM)
- MikroTik RouterOS 7.x
- Telegram Bot Token (from @BotFather)
- Google Gemini API key (or another LLM provider)
- Firebase project (or use local JSON fallback)

### CLI Mode

```bash
# Start interactive CLI
npm start

# Or run specific commands
agentos status                    # Quick overview
agentos network ping 8.8.8.8      # Ping test
agentos users kick john           # Disconnect user
agentos voucher create 1Day       # Generate voucher
```

### Daemon Mode (with Telegram/WhatsApp)

```bash
# Start gateway
agentos gateway --daemon

# Check status
agentos gateway:status

# View logs
tail -f logs/agentos.log
```

## 📸 Screenshots

<p align="center">
  <img src="docs/images/cli-demo.gif" width="600" alt="CLI Demo">
  <br>
  <em>Interactive CLI with real-time router feedback</em>
</p>
<p align="center">
  <img src="docs/images/telegram-bot.png" width="300" alt="Telegram Bot">
  &nbsp;&nbsp;
  <img src="docs/images/whatsapp-chat.png" width="300" alt="WhatsApp">
  <br>
  <em>Unified messaging interface</em>
</p>

> AI-powered MikroTik management with multi-channel control via Telegram, WhatsApp, and WebSocket CLI

---

## 🏗️ Architecture

```text
(See diagram in the repository for a full ASCII architecture diagram)
```

### Key Subsystems

| Module | File | Role |
|--------|------|------|
| Core Engine | `agentos.mjs` | Entry point, boot sequence |
| Gateway | `src/core/gateway.js` | WebSocket + HTTP server |
| MikroTik Manager | `src/core/mikrotik.js` | RouterOS API adapter |
| AI Engine | `src/core/ask-engine.js` | Gemini ReAct loop |
| Billing | `src/core/universal-billing.js` | Voucher + payment flow |
| Sentinel | `agentos-sentinel.rsc` | On-router native agent |
| CLI | `bin/agentos.js` | Commander.js entry |

---

## Billing Plans

| Plan | Duration | Data Quota |
|------|----------|------------|
| 1Day | 24 hours | 7 GB |
| 7Day | 7 days  | 21 GB |
| 30Day | 30 days | 60 GB |

Payment flow: **Provider adapter → payment persistence interface → idempotent settlement → voucher/order fulfillment → MikroTik hotspot access**

Firebase and Supabase are infrastructure adapters, not core dependencies. Payment persistence, user data, shop data, and authentication must be accessed through provider-neutral ports.

---

## Repository Structure

```
br3eze-code/
├── agentos.mjs              Main entry (ESM)
├── agentos-sentinel.rsc     RouterOS native agent
├── mikro.rsc                RouterOS bootstrap scripts
├── bin/agentos.js           CLI entry point
├── src/
│   ├── core/
│   │   ├── mikrotik.js       RouterOS manager
│   │   ├── gateway.js        WebSocket server
│   │   ├── database.js       Provider-neutral database port
│   │   ├── persistence.js    Persistence provider port
│   │   ├── notification-port.js Notification delivery port
│   │   └── logger.js         Winston logger
│   ├── adapters/
│   │   ├── auth/             Firebase/Supabase auth adapters
│   │   ├── persistence/      Database and payment persistence adapters
│   │   └── commerce/         Orders, couriers, notifications
│   ├── domains/commerce/     Provider-neutral commerce logic
│   ├── payments/             Payment rails and settlement
│   ├── api/                  Authenticated API routes and middleware
│   └── cli/
│       ├── program.js       Commander setup
│       └── commands/        CLI subcommands
├── agents/                  AI agent modules
├── services/                Billing, voucher, payment
├── adapters/                Channel adapters (TG, WA)
├── skills/                  Agent skill definitions
├── workflows/               Automation workflows
├── apps/shared/AgentOSkit/  Shared SDK
├── custom-plugins/          Cordova plugin: aicore
├── vscode-extension/        VS Code extension
├── www/                     Web UI (cyberpunk portal)
├── docs/                    Documentation
├── tests/                   Test suites
└── scripts/                 Deployment scripts
```

---

## Command Line Interface

```
agentos
├── onboard                   Interactive setup wizard
├── gateway                   WebSocket + Telegram gateway
│   ├── --daemon              Run as background service
│   ├── --force               Kill existing process first
│   └── gateway:stop          Graceful shutdown
├── status (s)                System overview
├── doctor [--fix]            Health check + auto-repair
├── network (net)
│   ├── ping <host>           ICMP ping via router
│   ├── scan                  DHCP lease scan
│   ├── firewall              List firewall rules
│   ├── block <ip|mac>        Add drop rule
│   └── unblock <ip|mac>      Remove drop rule
��── users (user)
│   ├── list [--all]          Active / all hotspot users
│   ├── kick <username>       Disconnect user
│   ├── add <username>        Create hotspot user
│   ├── remove <username>     Delete user
│   └── status <username>     Check online + usage
├── voucher (v)
│   ├── create [plan]         Generate voucher (1Day|7Day|30Day)
│   ├── list                  Recent vouchers
│   ├── revoke <code>         Delete unused voucher
│   └── stats                 Revenue + usage stats
└── config
    ├── get <path>            Read config value
    ├── set <path> <value>    Write config value
    ├── edit                  Open in $EDITOR
    └── show                  Display full config
```

## Telegram Commands

```
/start      Authenticate and show menu
/status     Router status overview
/users      Active user list with kick buttons
/kick       Kick a user by name
/voucher    Create voucher with plan selector
/stats      Network + billing stats
/ping       Ping a host
/firewall   Show firewall rules
/help       Full command list
```

## 📖 Documentation

- [Installation Guide](docs/install.md)
- [Telegram Setup](docs/telegram.md)
- [WhatsApp Setup](docs/whatsapp.md)
- [API Reference](docs/api.md)
- [Available Skills](SKILL.md)
- [Project Specification](SPEC.md)
- [Getting Started](START_HERE.md)
- [Contributing](CONTRIBUTING.md)

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 22+ ESM |
| Router API | MikroTik RouterOS API (routeros-client) |
| AI Engine | Google Gemini 2.5 / other providers |
| Messaging | node-telegram-bot-api + Baileys |
| Payments | Mastercard A2A · OAuth 1.0a RSA-SHA256 |
| Data providers | Provider-neutral adapters with Firebase, Supabase, PHP fallback, and local persistence implementations |
| Gateway | WebSocket (ws) + Express |
| CLI | Commander.js |
| Logging | Winston |

## Deployment

### Docker

```bash
docker compose up -d
```

### Podman

```bash
cp agentos.podman.env .env
podman play kube agentos.yaml
```

### User-local CLI and Desktop installation

The supported installation path is user-local and idempotent. It keeps the CLI, Desktop runtime, and profile state under the operator’s home directory and never copies API keys into shell startup files. Node.js 22+, npm, and Git are required.

On Linux or macOS, download the script first, review it, and execute the local file:

```bash
curl -fsSL https://br3eze.africa/install.sh -o /tmp/agentos-install.sh
less /tmp/agentos-install.sh
bash /tmp/agentos-install.sh --ref upgrade/commerce-domains
source ~/.bashrc  # or ~/.zshrc
agentos onboard
agentos login
```

On Windows PowerShell:

```powershell
Invoke-WebRequest https://br3eze.africa/install.ps1 -OutFile $env:TEMP\agentos-install.ps1
Get-Content $env:TEMP\agentos-install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\agentos-install.ps1 -Ref upgrade/commerce-domains
# Open a new PowerShell window, then:
agentos onboard
agentos login
```

The default locations are `~/.agentos/app` and `~/.agentos/bin` on Unix, and `%USERPROFILE%\\.agentos\\app` and `%USERPROFILE%\\.agentos\\bin` on Windows. Use `--profile NAME` to keep separate tenants or environments isolated. Use `--desktop` only when you want the installer to fetch development dependencies and build the Electron directory package:

```bash
bash /tmp/agentos-install.sh --desktop
# or on PowerShell:
# powershell -ExecutionPolicy Bypass -File $env:TEMP\agentos-install.ps1 -Desktop
```

The installer does **not** enable a network daemon or system service automatically. For a long-running gateway, use the platform’s service manager only after configuring an explicit service account, working directory, environment provider, firewall policy, and log rotation. The local profile and credential store remain user-scoped.

### RouterOS Sentinel

```bash
# Upload via WinBox Files or SCP, then:
/import file-name=agentos-sentinel.rsc
# Verify
/system/scheduler print
```

---

## Current System Context

AgentOS is a multi-surface network, commerce, billing, and automation platform. The repository includes a Node.js/ESM runtime, a browser/PWA portal, a Cordova Android application shell, PHP fallback endpoints, RouterOS scripts, custom native plugins, payment rails, channel adapters, and reusable skills.

### Provider-neutral architecture

Core and domain code must not import Firebase, Supabase, PHP, Vercel, or a specific payment provider directly. Integrations are registered behind ports and adapters:

- `src/core/database.js` — database capability boundary.
- `src/core/persistence.js` — provider-neutral persistence registration and access.
- `src/core/notification-port.js` — email, PWA, and channel notification boundary.
- `src/adapters/auth/` — authentication providers.
- `src/adapters/persistence/` — Firebase, Supabase, SQLite, and payment persistence.
- `src/adapters/commerce/` — orders, couriers, invoices, and notifications.
- `www/js/05.provider-adapter.js` — frontend provider registry.
- `www/js/06.firebase.js` and `www/js/07.auth.js` — frontend Firebase/Supabase adapter registration.

The browser preserves compatibility APIs such as `DataStore`, but new callers should use the provider registry or authenticated API client. Do not put service-role keys, provider SDK credentials, or payment secrets in browser code.

### Data and PHP fallback coverage

`www/data_api.php` provides authenticated, tenant-scoped fallback endpoints for users, plans, tickets, products, and orders. Order creation validates quantities, recomputes totals from server-side product data, enforces stock limits, uses transactions, and requires an idempotency key. `www/api.php` and the PHP domain adapters cover legacy billing, MikroTik, voucher, and payment fallback workflows.

The PHP layer is a fallback adapter, not a second source of truth. Any new data capability must be added to the provider-neutral contract and then implemented consistently for the active backend adapters.

### Payments and commerce

Payment providers live under `src/payments/providers/` and are selected through provider rails and persistence interfaces. Payment callbacks must be authenticated, idempotent, tenant-scoped, and reconciled before fulfillment. Shop logic covers products, inventory, carts, orders, fulfillment, invoices, and courier tracking. Never trust client-supplied prices, quantities, totals, status transitions, or user identifiers.

### Notifications, email, channels, and tracking

Order lifecycle notifications use `src/core/notification-port.js` and `src/adapters/commerce/order-notifier.js`. Supported delivery surfaces include PWA/event-bus notifications and existing Telegram/WhatsApp channel paths. Email is intentionally disabled until a transactional provider or SMTP adapter is configured. The canonical sender is `no-reply@br3eze.africa`; configure a verified domain and provider before enabling delivery. Notification events should use stable idempotency keys such as `order.created:<order-id>`.

Password-reset email remains owned by the configured authentication adapter. Do not implement password-reset tokens in PHP or send them through a generic notification route.

### PWA and Cordova

The browser shell is under `www/`. `www/manifest.json` defines install metadata, while `www/sw.js` caches the app shell and falls back to `./index.html` for offline navigation. Cordova uses `config.xml` plus the local plugins under `custom-plugins/`:

- `cordova-plugin-aicore`
- `cordova-plugin-background-modern`
- `cordova-plugin-network-tools`
- `cordova-plugin-wifi-billing-agent`

Plugin-owned Android permissions belong in each plugin's `plugin.xml`; app-wide permissions should remain minimal in `config.xml`. The background plugin exposes both `backgroundModern` and the compatibility `backgroundMode` bridge. Generated `plugins/` and `platforms/` directories are build output and should not be treated as source.

### Environment contract

Copy `.env.example` to a private environment file and enable only the features you use. The template documents auth/provider selection, Firebase/Supabase adapters, email/SMTP/Resend, tenant and site scope, payment rails, courier tracking, channels, and infrastructure providers. It is a contract, not a secret store. Never commit real credentials, private keys, service-role keys, webhook secrets, or production passwords.

Important rules:

- Browser-safe values use `NEXT_PUBLIC_` or generated frontend configuration only.
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, payment keys, SMTP passwords, and private keys are server-only.
- Use one canonical variable name per feature; legacy aliases exist only for compatibility.
- Keep production, preview, development, and local environments separate.
- Validate required variables by enabled feature rather than requiring every optional integration.

### Security and tenancy

Every user-data, payment, order, voucher, channel, and device operation must carry authenticated identity and tenant/site scope. Apply authorization before provider calls, use parameterized queries, enable RLS for exposed Supabase tables, and use `(select auth.uid())` in policies. Never authorize from user-editable metadata. Log audit events without secrets or payment credentials.

### Tests and validation

The repository includes unit, integration, PHP contract, provider-boundary, PWA asset, notification, and production test suites. Common checks are:

```bash
npm run test:production
npm run vercel:build
npm run check:ci-quality
git diff --check
```

When PHP is available, also run:

```bash
find www scripts tests -name '*.php' -print0 | xargs -0 -n1 php -l
```

Native Cordova validation requires a clean Android platform regeneration in an Android-capable build environment. Do not hand-edit generated native files.

### Release and deployment

The production candidate must come from the repository's canonical protected branch and verified deployment path. Do not treat arbitrary `v0/*` branches or previews as production releases. Verify environment separation, build output, domains, webhook routes, and rollback readiness before promotion.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for full guidelines.

Quick contributions:

- ⭐ Star this repository
- 🐛 Open an issue: https://github.com/br3eze-code/br3eze-code/issues
- 💡 Start a discussion: https://github.com/br3eze-code/br3eze-code/discussions
- 📖 Improve documentation
- 🔧 Submit a PR tagged `good-first-issue`

---

## 📜 License

Apache-2.0 © 2026 Brighton Mzacana · br3eze.africa

---

<p align="center">
  <a href="https://github.com/br3eze-code/br3ezeclaw/stargazers">
    <img src="https://img.shields.io/github/stars/br3eze-code/br3ezeclaw?style=social" alt="Stars">
  </a>
  <a href="https://github.com/br3eze-code/br3ezeclaw/network/members">
    <img src="https://img.shields.io/github/forks/br3eze-code/br3ezeclaw?style=social" alt="Forks">
  </a>
</p>

<p align="center">
  <strong>⭐ Star this repo if it helps you manage your network!</strong>
</p>

<div align="center">
<sub>Built for Africa's community networks · Powered by AI · Controlled via Telegram</sub>
</div>
