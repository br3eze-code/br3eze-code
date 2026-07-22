```
Directory structure:
└── br3eze-code-br3eze-code/
    ├── README.md
    ├── agentos-sentinel.rsc
    ├── AgentOS.bat
    ├── AgentOS.desktop
    ├── agentos.mjs
    ├── agentos.podman.env
    ├── agentos.yaml
    ├── config.xml
    ├── CONTRIBUTING.md
    ├── deploy.sh
    ├── deploy.yml
    ├── docker-compose.yml
    ├── Dockerfile
    ├── firebase.json
    ├── firestore.indexes.json
    ├── firestore.rules
    ├── flake.nix
    ├── install.sh
    ├── jsconfig.json
    ├── LICENSE
    ├── migration.js
    ├── mikro.rsc
    ├── package.json
    ├── run-agent.ps1
    ├── Setup-AgentOS.ps1
    ├── setup-podman.sh
    ├── SKILL.md
    ├── SPEC.md
    ├── START_HERE.md
    ├── test-firebase.js
    ├── test-mikrotik.js
    ├── tsconfig.json
    ├── workspace.json
    ├── .env.example
    ├── .npmignore
    ├── .socketignore
    ├── adapters/
    │   ├── base.adapter.js
    │   ├── claude.adapter.js
    │   ├── gemini.adapter.js
    │   ├── localLLM.js
    │   ├── openai.adapter.js
    │   └── openclaw/
    │       └── meta.js
    ├── agents/
    │   ├── alerts.py
    │   ├── biology.py
    │   ├── broadcast.py
    │   ├── can.py
    │   ├── cfd.py
    │   ├── chem.py
    │   ├── dasboard.py
    │   ├── data.py
    │   ├── dyno.py
    │   ├── kali.py
    │   ├── network.agent.js
    │   ├── pcb.py
    │   ├── print.py
    │   ├── protein.py
    │   └── sql.py
    ├── api/
    │   └── v1alpha1/
    │       └── approval_types.go
    ├── apps/
    │   └── shared/
    │       └── AgentOSkit/
    │           ├── package.swift
    │           └── sources/
    │               ├── AgentOSKit/
    │               │   └── Resources/
    │               │       ├── tool-display.json
    │               │       └── CanvasScaffold/
    │               │           └── scaffold.html
    │               └── AgentOSProtocol/
    │                   ├── AnyCodable.swift
    │                   └── WizardHelpers.swift
    ├── config/
    │   ├── br3eze.yaml
    │   ├── config.json
    │   ├── domains.js
    │   ├── firebase.js
    │   ├── schema.js
    │   └── schemas/
    │       └── config.schema.json
    ├── controllers/
    │   └── approval_controller.go
    ├── custom-plugins/
    │   └── cordova-plugin-aicore/
    │       ├── package.json
    │       ├── plugin.xml
    │       ├── src/
    │       │   └── android/
    │       │       ├── AiCapabilityDetector.java
    │       │       ├── AICorePlugin.java
    │       │       ├── AiRouter.java
    │       │       └── models/
    │       │           └── AiResponse.java
    │       └── www/
    │           └── AICore.js
    ├── docker/
    │   └── blender-render/
    │       └── Dockerfile
    ├── docs/
    │   ├── api.md
    │   ├── install.md
    │   └── SKILL.md
    ├── extentions/
    │   ├── chrome/
    │   │   ├── background.js
    │   │   ├── content.js
    │   │   ├── manifest.json
    │   │   ├── popup.html
    │   │   └── popup.js
    │   └── vscode/
    │       ├── README.md
    │       ├── extension.js
    │       ├── package.json
    │       ├── .vscodeignore
    │       └── src/
    │           ├── api.ts
    │           ├── extention.ts
    │           ├── package.json
    │           ├── recordPanel.ts
    │           ├── skillsView.ts
    │           └── tsconfig.json
    ├── grafana/
    │   └── agentos-audit.json
    ├── helm/
    │   └── agentos/
    │       ├── Chart.yaml
    │       ├── value.yaml
    │       └── templates/
    │           └── deployment.yaml
    ├── knowledge/
    │   ├── identity.md
    │   ├── inventory.json
    │   ├── mikrotik-patterns.md
    │   ├── network-topology.md
    │   ├── soul.md
    │   └── user-preference.md
    ├── scripts/
    │   ├── completion.sh
    │   ├── postinstall.js
    │   ├── preuninstall.js
    │   └── podman/
    │       ├── agentos.container.in
    │       └── setup.sh
    ├── server/
    │   ├── server.js
    │   └── src/
    │       ├── config/
    │       │   ├── firebase.js
    │       │   └── mikrotik.js
    │       ├── middleware/
    │       │   ├── errorHandler.js
    │       │   └── validate.js
    │       ├── routes/
    │       │   ├── admin.js
    │       │   ├── auth.js
    │       │   ├── mikrotik.js
    │       │   └── webhooks.js
    │       ├── services/
    │       │   ├── firebaseAuth.js
    │       │   ├── mikrotikAPI.js
    │       │   └── sessionManager.js
    │       └── utils/
    │           ├── crypto.js
    │           ├── helpers.js
    │           └── logger.js
    ├── services/
    │   ├── mastercardA2A.js
    │   ├── messagingAdapter.js
    │   ├── mikrotikAPI.js
    │   └── whatsapp.js
    ├── skills/
    │   ├── base.js
    │   ├── codegen.js
    │   ├── create_agent.js
    │   ├── create_user.js
    │   ├── freeze.js
    │   ├── hotspot_brand.js
    │   ├── memory.js
    │   ├── note.js
    │   ├── onboard.js
    │   ├── rollback.js
    │   ├── router_health.js
    │   ├── self_edit.js
    │   ├── skill_create.js
    │   ├── SkillRegistry.js
    │   ├── ui_agent.js
    │   ├── ui_record.js
    │   ├── calendar/
    │   │   ├── index.js
    │   │   └── skill.json
    │   ├── coding/
    │   │   └── index.js
    │   ├── cordova/
    │   │   └── index.js
    │   ├── design/
    │   │   └── index.js
    │   ├── email/
    │   │   ├── index.js
    │   │   └── skill.json
    │   ├── general/
    │   │   └── index.js
    │   ├── mcporter/
    │   │   ├── index.js
    │   │   └── skill.json
    │   ├── mikrotik/
    │   │   ├── index.js
    │   │   ├── manifest.yaml
    │   │   └── skill.json
    │   ├── nanopdf/
    │   │   ├── index.js
    │   │   ├── skill.json
    │   │   └── templates/
    │   │       ├── invoice.html
    │   │       └── report.html
    │   ├── system/
    │   │   └── index.js
    │   ├── tasks/
    │   │   ├── index.js
    │   │   └── skill.json
    │   ├── tts/
    │   │   ├── index.js
    │   │   └── skill.json
    │   ├── vmware/
    │   │   ├── bridge.py
    │   │   └── index.js
    │   └── windows/
    │       └── index.js
    ├── src/
    │   ├── agentEngine.js
    │   ├── agentRuntime.js
    │   ├── kernel.js
    │   ├── ai/
    │   │   ├── aiRouter.js
    │   │   ├── coordinator.js
    │   │   ├── qnap-integration.js
    │   │   └── universal-coordinator.js
    │   ├── api/
    │   │   ├── mobile-bridge.js
    │   │   └── routes/
    │   │       ├── v1.js
    │   │       └── v2.js
    │   ├── channels/
    │   │   ├── base.js
    │   │   ├── BaseChannel.js
    │   │   ├── discord.js
    │   │   ├── index.js
    │   │   ├── slack.js
    │   │   ├── telegram.js
    │   │   ├── websocket.js
    │   │   └── whatsapp.js
    │   ├── cli/
    │   │   └── commands/
    │   │       ├── config.js
    │   │       ├── dashboard.js
    │   │       ├── doctor.js
    │   │       ├── domain.js
    │   │       ├── gateway.js
    │   │       ├── networks.js
    │   │       ├── onboard.js
    │   │       ├── skill.js
    │   │       ├── status.js
    │   │       ├── users.js
    │   │       └── voucher.js
    │   ├── core/
    │   │   ├── ACPClient.js
    │   │   ├── agent-runtime.js
    │   │   ├── agent.js
    │   │   ├── agentEngine.js
    │   │   ├── agentKernel.js
    │   │   ├── AgentOS.js
    │   │   ├── agentPolicy.js
    │   │   ├── agentRuntime.js
    │   │   ├── approval.js
    │   │   ├── ask-engine.js
    │   │   ├── auth.js
    │   │   ├── chaosMonkey.js
    │   │   ├── ChaosMonkey.v2.js
    │   │   ├── config.js
    │   │   ├── database-enhanced.js
    │   │   ├── database.js
    │   │   ├── diagnostics.js
    │   │   ├── docs.html
    │   │   ├── error.js
    │   │   ├── errors.js
    │   │   ├── eventBus.js
    │   │   ├── firebase.js
    │   │   ├── gateway-daemon.js
    │   │   ├── gateway-engine.js
    │   │   ├── gateway.js
    │   │   ├── HealthMonitor.js
    │   │   ├── heartbeat.js
    │   │   ├── loadDomain
    │   │   ├── logger.js
    │   │   ├── memory-store.js
    │   │   ├── metrics.js
    │   │   ├── mikrotik.js
    │   │   ├── missionDispatch.js
    │   │   ├── monitor.js
    │   │   ├── operationProgress.js
    │   │   ├── permissions.js
    │   │   ├── PluginManager.js
    │   │   ├── policy.js
    │   │   ├── provider-manager.js
    │   │   ├── resource-model.js
    │   │   ├── runtime.js
    │   │   ├── safety-envelope.js
    │   │   ├── security.js
    │   │   ├── server.js
    │   │   ├── session-manager.js
    │   │   ├── session.js
    │   │   ├── sessionManager.js
    │   │   ├── sessions.js
    │   │   ├── sessionStore.js
    │   │   ├── SkillEngine.js
    │   │   ├── SkillRegistry.js
    │   │   ├── taskRegistry.js
    │   │   ├── telegram.js
    │   │   ├── TelemetryCollector.js
    │   │   ├── tool-registry.js
    │   │   ├── toolEngine.js
    │   │   ├── ToolRegistry.js
    │   │   ├── tracing.js
    │   │   ├── transcript.js
    │   │   ├── universal-billing.js
    │   │   ├── voucher.js
    │   │   ├── websocket.js
    │   │   ├── whatsapp.js
    │   │   ├── WorkflowEngine.js
    │   │   ├── workflows.js
    │   │   ├── workspace.js
    │   │   ├── acp/
    │   │   │   └── ACPClient.js
    │   │   ├── channels/
    │   │   │   ├── BaseChannel.js
    │   │   │   ├── ChannelManager.js
    │   │   │   ├── CLIChannel.js
    │   │   │   ├── DiscordChannel.js
    │   │   │   ├── SlackChannel.js
    │   │   │   ├── TelegramChannel.js
    │   │   │   ├── WebSocketChannel.js
    │   │   │   └── WhatsappChannel.js
    │   │   ├── llm/
    │   │   │   ├── LLMCoordinator.js
    │   │   │   └── providers/
    │   │   │       └── GeminiProvider.js
    │   │   ├── memory/
    │   │   │   ├── MemoryManager.js
    │   │   │   └── adapters/
    │   │   │       └── MemoryAdapter.js
    │   │   ├── providers/
    │   │   │   └── index.js
    │   │   └── skills/
    │   │       ├── SkillRegistry.js
    │   │       └── mikrotik/
    │   │           ├── index.js
    │   │           └── skill.json
    │   ├── dashboard/
    │   │   └── missionControl.js
    │   ├── domains/
    │   │   ├── compute/
    │   │   │   └── index.js
    │   │   ├── developer/
    │   │   │   └── index.js
    │   │   ├── general/
    │   │   │   └── index.js
    │   │   ├── linux/
    │   │   │   └── index.js
    │   │   ├── mikrotik/
    │   │   │   └── index.js
    │   │   ├── network/
    │   │   │   └── index.js
    │   │   └── security/
    │   │       └── index.js
    │   ├── interfaces/
    │   │   ├── api.js
    │   │   └── telegram.js
    │   ├── middleware/
    │   │   ├── AuthMiddleware.js
    │   │   └── RateLimiter.js
    │   ├── plugins/
    │   │   ├── base-adapter.js
    │   │   ├── registry.js
    │   │   └── adapters/
    │   │       ├── aws-adapter.js
    │   │       ├── docker-adapter.js
    │   │       └── mikrotik-adapters.js
    │   ├── policies/
    │   │   ├── defense.prompt
    │   │   ├── role.json
    │   │   ├── roles.json
    │   │   └── tools.schema.json
    │   ├── providers/
    │   │   ├── base.js
    │   │   ├── claude.js
    │   │   ├── gemini.js
    │   │   ├── ollama.js
    │   │   └── openai.js
    │   ├── services/
    │   │   ├── mikrotik.js
    │   │   ├── sessions.js
    │   │   └── vouchers.js
    │   ├── skills/
    │   │   ├── codgen.js
    │   │   ├── linux.js
    │   │   ├── aws/
    │   │   │   └── index.js
    │   │   ├── blender/
    │   │   │   └── index.js
    │   │   ├── codegen/
    │   │   │   ├── index.js
    │   │   │   └── skill.json
    │   │   ├── dahua/
    │   │   │   └── index.js
    │   │   ├── files/
    │   │   │   └── index.js
    │   │   ├── flstudio/
    │   │   │   └── index.js
    │   │   ├── gcp/
    │   │   │   └── index.js
    │   │   ├── github/
    │   │   │   └── index.js
    │   │   ├── gossip/
    │   │   │   └── index.js
    │   │   ├── hikivision/
    │   │   │   └── index.js
    │   │   ├── kubernetes/
    │   │   │   └── index.js
    │   │   ├── language/
    │   │   │   └── index.js
    │   │   ├── macos/
    │   │   │   └── index.js
    │   │   ├── mikrotik/
    │   │   │   ├── manifest.yaml
    │   │   │   ├── skill.json
    │   │   │   └── SKILL.md
    │   │   ├── pagerduty/
    │   │   │   └── index.js
    │   │   ├── research/
    │   │   │   └── index.js
    │   │   ├── slack/
    │   │   │   └── index.js
    │   │   ├── system/
    │   │   │   └── index.js
    │   │   └── unreal/
    │   │       └── index.js
    │   ├── tools/
    │   │   ├── base.js
    │   │   ├── index.js
    │   │   ├── tool.js
    │   │   ├── developer/
    │   │   │   ├── codeGenTool.js
    │   │   │   └── infraTool.js
    │   │   └── mikrotik/
    │   │       ├── network.ping/
    │   │       │   └── tool.yaml
    │   │       └── user.add/
    │   │           ├── handler.js
    │   │           └── tool.yaml
    │   └── utils/
    │       ├── CircuitBreaker.js
    │       ├── formatters.js
    │       ├── helpers.js
    │       ├── logger.js
    │       └── validator.js
    ├── terraform/
    │   └── eks/
    │       └── main.tf
    ├── test-planner/
    │   ├── catalog.mjs
    │   ├── executor.mjs
    │   ├── run-time.mjs
    │   └── vitest-args.mjs
    ├── tests/
    │   ├── AgentOS.test.js
    │   ├── mikrotik.test.js
    │   ├── intergration/
    │   │   └── pipeline.test.js
    │   └── unit/
    │       ├── adaptersAndAgent.test.js
    │       ├── agentRuntime.test.js
    │       ├── errors.test.js
    │       ├── eventBusAndVoucher.test.js
    │       ├── fileIO.test.js
    │       ├── formatter.test.js
    │       ├── mikrotik.test.js
    │       ├── permissions.test.js
    │       ├── safetyEnvelope.test.js
    │       ├── sessionManager.test.js
    │       └── taskRegistry.test.js
    ├── tools/
    │   ├── camera.py
    │   ├── f1_sim.py
    │   ├── gemma.py
    │   ├── gkeep.py
    │   ├── nano.py
    │   ├── package.json
    │   ├── registry.mjs
    │   ├── whisper.py
    │   ├── db/
    │   │   └── user.js
    │   ├── mikrotik/
    │   │   └── createUser.js
    │   ├── payments/
    │   │   └── receipts.js
    │   ├── system/
    │   │   ├── fileIO.js
    │   │   ├── logger.js
    │   │   └── scheduler.js
    │   └── telegram/
    │       └── sendMessage.js
    ├── typings/
    │   └── cordova-typings.d.ts
    ├── vscode-extension/
    │   └── src/
    │       └── extension.ts
    ├── workflows/
    │   └── backup-users.json
    ├── www/
    │   ├── intents.json
    │   ├── css/
    │   │   ├── index.css
    │   │   └── style.css
    │   └── js/
    │       ├── ai-ochestrator.js
    │       ├── app.js
    │       ├── client.js
    │       ├── config.js
    │       ├── hotspot-agent.js
    │       ├── index.js
    │       ├── ledger.js
    │       ├── nanoai.js
    │       ├── oauth-vault.js
    │       ├── react-engine.js
    │       ├── security.js
    │       ├── slave-node.js
    │       ├── storage.js
    │       ├── tools.js
    │       ├── ui.js
    │       └── websocket.js
    └── .github/
        └── workflows/
            ├── ci.yml
            ├── deploy.yml
            └── node.js.yml
```
