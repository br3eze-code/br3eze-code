# Contributing to AgentOS (br3eze-code)

Thank you for considering contributing to AgentOS!

Important note — live vs legacy code
- This repository contains multiple generations of the same subsystems. Some files are legacy, duplicated, or kept for historical reasons. See CLAUDE.md for a comprehensive list of known legacy files.
- Before editing, confirm the file is on the live boot path (see docs/DEVELOPER_ONBOARDING.md). Editing legacy files can introduce confusion and accidental regressions.

How to contribute (short)
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests where applicable (`tests/`)
5. Run lint and tests: `npm run lint && npm test`
6. Commit with clear messages
7. Push and open a Pull Request

Development setup
```bash
git clone https://github.com/br3eze-code/br3eze-code.git
cd br3eze-code
npm install
cp .env.example .env
npm run dev
```

Good First Issues
- Add a messaging adapter or improve an existing one (Telegram, WhatsApp) — follow the adapters in src/core/channels/
- Improve voucher QR code design
- Add Prometheus metrics exporter
- Write more integration tests
- Polish VS Code extension (vscode-extension/)

Code style
- Use ESLint (run `npm run lint`) and prefer `async/await`
- Keep skills modular in `skills/`
- Document new skills in SKILL.md

Adding a new payment provider
- Add a provider under `src/payments/providers/` and register it with the payment gateway (src/payments/payment-gateway.js). See docs/payments/mastercard.md for a template and guidance.

Questions?
Open an issue or start a discussion in the repo.