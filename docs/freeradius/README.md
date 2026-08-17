# Regional FreeRADIUS and central AgentOS topology

These templates target FreeRADIUS 3.x. They are configuration templates, not production secrets. Replace every `CHANGE_ME_*` value, restrict file permissions to the radius service account, and transport RADIUS only over WireGuard, IPsec, or a private network.

The regional proxy accepts requests from registered MikroTik NAS devices, adds the controlled regional routing identity, and proxies authentication/accounting to the central server. The central server trusts only registered regional proxy clients and maps the `NAS-Identifier`/proxy identity to a tenant and site in AgentOS.

The `users` files below are deliberately minimal. Production user state should come from the central AgentOS/RADIUS SQL or REST adapter, not from long-lived plaintext users files.

Required additional FreeRADIUS 3.x work outside these three files:

1. Enable the `proxy.conf` policy from `proxy.conf.example` and define the `home_server_pool` referenced by the regional `radiusd.conf`.
2. Enable the `default` virtual server and ensure its `authorize`, `accounting`, and `post-auth` sections call `files`/`sql`/`rest` and `pre proxy`/`post proxy` as appropriate.
3. Install and configure the `rlm_sql`, `rlm_rest`, or AgentOS-specific module selected for central identity.
4. Register each MikroTik NAS and regional proxy with a unique secret; never reuse a secret across sites.
5. Allow UDP 1812 and 1813 only on the private transport and apply firewall rate limits.

Recommended identity tuple:

```text
region_id + site_id + nas_identifier + router_fingerprint
```

Do not trust tenant or site identifiers supplied by a user or arbitrary RADIUS client. The central AgentOS adapter must validate the registered NAS identity before applying tenant policy.
