# Telegram Ingestion Evidence

The official Telegram Bot API documentation states that bots receive updates through two mutually exclusive mechanisms: `getUpdates` polling or webhooks. The cloud architecture should therefore use one mode per bot token, with webhooks preferred for event delivery and a durable queue between ingress and AgentOS execution. Long polling is a fallback only when a webhook endpoint cannot be used.

The official API documentation also specifies HTTPS Bot API requests and token-based authentication. Bot tokens must remain in a managed secret store and must never enter tenant records, Work/Loop evidence, logs, or customer messages.

Source: [Telegram Bot API](https://core.telegram.org/bots/api), accessed 2026-08-17.
