# Irish Wireless and IronWiFi integration study

Status: research-backed design and initial adapter scaffold. Credentials, tenant access, runtime registration and CI have not been verified.

## Executive conclusion

Treat the references differently.

- Irish Wireless: public evidence describes a wireless deployment/supply business. Its public company profile reports an orderly wind-down and says its founder would continue handling ongoing requirements while focusing on BBnet. No public Irish Wireless API specification was verified. Do not invent endpoints or scrape a replacement interface.
- BBnet: public service pages and case studies describe hardware-agnostic managed Wi-Fi, site-specific coverage planning, a single accountable provider, resilient dual connectivity/failover, network segmentation, 24/7 monitoring/support, phased installation and Wi-Fi-as-a-Service. These are operational patterns, not APIs Br3eze can call.
- IronWiFi: public REST documentation covers users, groups, networks, captive portals, vouchers, reports and webhooks. Requests use HTTPS and bearer-token authentication. Documentation states 100 requests per minute per API key. Public docs show route and voucher-payload variations, so the tenant's live OpenAPI document must be authoritative.

## Research sources

- Irish Wireless company profile and wind-down note: https://ie.linkedin.com/company/irish-wireless
- BBnet managed Wi-Fi model: https://www.bbnet.ie/wifi-as-a-service
- BBnet hotel network design: https://www.bbnet.ie/case-study/europe-hotel-%26-resort-
- BBnet resilient connectivity case study: https://www.bbnet.ie/case-study/woodlands-house-hotel-%26-spa-
- IronWiFi API reference: https://www.ironwifi.com/api/
- IronWiFi endpoint reference: https://help.ironwifi.com/api/endpoints
- IronWiFi webhooks: https://help.ironwifi.com/api/webhooks

## Comparison

| Area | Irish Wireless / BBnet patterns | IronWiFi API | Br3eze direction |
| --- | --- | --- | --- |
| System design | Site-specific wireless design, coverage planning and installation | Network and captive-portal resources | Provider-neutral site/network inventory; RF planning remains a separate capability |
| Connectivity | Managed links, failover and support | Network resources and reports; not a WAN-carrier/router API replacement | Normalize health and incidents; separate adapters for each carrier/device |
| Access | Guest/staff segmentation and tailored guest experience | User/group, network, portal and voucher resources | Canonical Wi-Fi access contract |
| Operations | One accountable provider, monitoring and phased rollout | Authentication/session/user/voucher webhooks and reports | Event intake, incident correlation, support workflow and verified recovery |
| Commercial | Wi-Fi-as-a-Service and monthly-cost model | Service-side API automation; no Br3eze commercial terms implied | Keep subscriptions, settlement and invoicing in Br3eze commerce |
| API evidence | No public Irish Wireless API spec verified | Public REST/OpenAPI documentation | Implement IronWiFi adapter; await authorized Irish Wireless API documentation |

## Existing Br3eze building blocks inspected on main

- src/adapters/network/mikrotik-adapter.js — RouterOS lifecycle facade, resource discovery, actions and metrics.
- src/skills/network-tools/index.js — provider selection, read/write authorization and RouterOS-centric action mapping. Do not stretch this contract to impersonate IronWiFi.
- src/domains/procurement/supplier-provisioning.js — useful approval, idempotency, tenant-scope, persistence-contract and lifecycle-evidence patterns.
- docs/architecture/non-network-deployment.md — domain adapters should remain optional; AgentRuntime is the canonical execution owner.

## IronWiFi adapter scaffold committed

File: src/adapters/network/ironwifi-adapter.js

- Injectable Fetch-compatible transport; no new package required.
- User, voucher, network, captive-portal and report resource methods.
- Configurable company scope and regional API base URL.
- HTTPS only; bearer token; redirects rejected; bounded timeout; provider response bodies are not copied into thrown errors.
- Base URL limited to official ironwifi.com / ironwifi.io host families.
- Mutations disabled unless trusted host config explicitly enables allowWrites.
- Does not auto-register into AgentRuntime. Runtime registration must preserve per-user authorization and tenant binding; allowWrites is only an additional host-level feature gate.
- Webhook signature verification and receiver are not implemented yet; they require a raw-body-aware authenticated ingress and event deduplication.

Tests added: tests/unit/ironwifi-adapter.test.js. They have been committed but have NOT been executed in this environment. No green test or CI claim is made.

### API compatibility caveat

The public endpoint reference shows versioned /api/v2 user paths and /api paths for other resources, with optional company scope. Public voucher examples differ. The adapter follows those path families, but verify the tenant's live OpenAPI spec and test against a non-production tenant before use.

## Canonical Br3eze workflows to implement

1. network.site.register — create a tenant/site-scoped record, inventory devices and attach a desired service profile.
2. network.design.review — record coverage/capacity requirements, WAN links, network segmentation and acceptance criteria; this is evidence capture, not automatic RF prediction.
3. wifi.access.provision — authorize, create/update a provider user or voucher, persist idempotency evidence, then read back status.
4. network.change.apply — generate a diff, require approval for disruptive changes, execute through a selected adapter, verify actual state and record evidence.
5. network.health.collect — normalize device telemetry, provider API observations and webhook events.
6. network.incident.manage — correlate signals, assign owner/severity, track remediation and verify recovery.
7. network.service.reconcile — compare expected users/sessions/vouchers with provider observations and report drift.
8. network.handover.create — export inventory, topology notes, acceptance results, support ownership and maintenance schedule.

Every mutation should carry tenant/site scope, actor, permission decision, idempotency key, correlation ID, timeout policy and a verifiable result. Retries must distinguish safe reads from writes whose provider-side idempotency is unknown.

## Next steps

1. Run the new unit tests plus architecture/security gates in CI and fix failures before claiming readiness.
2. Inspect the runtime/plugin registry and add explicit opt-in registration. Do not make the network skill depend on IronWiFi when it is not configured.
3. Add a provider-neutral wifi-service port so IronWiFi, local hotspot/voucher services and future providers can be substituted without changing AgentRuntime.
4. Add webhook ingress with HMAC-SHA256 verification over the raw body, event-ID deduplication, fast acknowledgement and asynchronous processing.
5. Add fake-provider tests for provisioning, read-back verification, reconciliation and recovery.
6. Keep Irish Wireless/BBnet workflows as design/support knowledge until an authorized vendor API contract is supplied.
