# Developer Onboarding — AgentOS

This document highlights the live entry points, where to make safe changes, and the shortest path from a fresh clone to tests and a running gateway.

Live entry points (the "real" runtime path)
- bin/agentos.js → main.js → src/core/gateway-engine.js (gateway / WebSocket + HTTP)  
- CLI commands: src/cli/commands/* — these are the command implementations wired by main.js  
- ESM build entry: agentos.mjs (loads dist/entry.js or dist/entry.mjs when the package is distributed)  

Why this matters
- This repo contains legacy/duplicate files (multiple gateway/engine/agent runtime implementations). Before editing, confirm the file is reachable from one of the live entry points above. See CLAUDE.md for a longer note on legacy vs live code.

Quick dev setup
```bash
git clone https://github.com/br3eze-code/br3eze-code.git
cd br3eze-code
npm install
cp .env.example .env   # fill required vars
npm run dev             # nodemon development loop (runs bin/agentos.js)
```

Run the gateway (local interactive)
```bash
# Run the gateway (same as `npm start`) — starts the CLI gateway/daemon commands
npm start
# Or run the modern ESM entry (when built)
node agentos.mjs
```

Run tests & lint
```bash
npm install
npm test
npm run lint
```

Where to add new features safely
- CLI commands: src/cli/commands/ (add tests in tests/ for new command behavior)
- Gateway channel adapters: src/core/channels/ (TelegramChannel, WhatsappChannel)
- MikroTik integration: src/core/mikrotik.js (primary RouterOS adapter)
- Payments & vouchers: src/payments/ and src/core/voucher.js (some billing logic lives in src/payments)

Notes & tips
- WhatsApp: Baileys auth state lives in data/ or .whatsapp-auth; avoid running multiple Baileys sockets simultaneously (session conflicts). See docs/payments/mastercard.md and CLAUDE.md for detail.
- Use `npm run lint:fix` to auto-fix simple lint issues.
- If you intend to change the AI stack or LLM coordinator, locate src/ai/coordinator.js and the AskEngine (src/core/ask-engine.js). There are multiple LLM adapters in src/ai/ and agents/.

If you want, I can open a PR with these onboarding docs (this file) and wire CI/test badges into README.