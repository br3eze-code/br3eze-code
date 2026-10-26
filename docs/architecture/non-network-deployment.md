# Non-network AgentOS deployment

AgentOS can be configured for a domain that does not use Wi-Fi or RouterOS. Start with `examples/non-network.env.example` and set `AGENTOS_DOMAIN` to the exact folder name of the domain adapter you want to load (for example, `retail`, `logistics`, or `support`). Create that adapter under `src/domains/<domain>/index.js` if it does not exist yet.

## What the domain selector currently controls

- `src/host/bootstrap.js` dynamically imports RouterOS and network onboarding adapters only for `network`, `wifi`, or `wifi-billing`.
- `main.js` dynamically registers the networking, user/hotspot, voucher, Dahua, Starlink, MikroTik, and Tailscale CLI commands only for those network domains.
- The gateway dynamically imports and connects to RouterOS only for those network domains.
- `src/core/loadDomain.js` can restrict domain registration to the selected domain; with no explicit selector it retains the legacy all-domain behavior.

The existing default remains `network` for backward compatibility. Set `AGENTOS_DOMAIN=retail` (or another non-network domain) explicitly to opt out of networking.

## Environment and secrets

Leave RouterOS variables blank in non-network deployments. Supply only the model, persistence, and channel credentials actually used by that deployment. Keep real secrets in the host's secret manager or a private local `.env`; never commit them.

`DATABASE_PROVIDER=local` is an example, not a universal production recommendation. Choose a persistence adapter that is installed and configured for the deployment.

## Remaining consolidation work

This is an opt-in boot boundary, not a claim that every legacy module is domain-neutral. The legacy `src/core/ask-engine.js` still contains built-in networking, voucher, finance, and printer tool declarations and should be migrated into optional domain/skill packages before it is used as a general-purpose execution engine. AgentRuntime remains the intended canonical runtime.
