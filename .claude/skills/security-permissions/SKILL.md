---
name: security-permissions
description: Assess authentication, authorization, secrets, input handling, tool permissions, shell execution, and sensitive operations before or after code changes. Use for auth, payments, router/network controls, tools, webhooks, APIs, deployment, and configuration changes.
---

# Security and Permissions Review

1. Identify trust boundaries, sensitive data, actors, privileges, and externally reachable entry points.
2. Verify authentication separately from authorization. Check tenant/user/agent ownership and deny-by-default behavior where appropriate.
3. Validate untrusted input at the boundary; use safe APIs and argument arrays instead of shell-string interpolation when invoking processes.
4. Never log, commit, echo, or include secrets in reports. Use placeholders and redact tokens, credentials, personal data, and sensitive router/network details.
5. Check tool permissions and high-impact actions: reboot, deletion, payments, deployments, router/firewall changes, migrations, and account changes require explicit authorization and appropriate safeguards.
6. Verify webhook signatures, replay protection, idempotency, and bounded retries when applicable.
7. Check dependency and repository security gates using existing project scripts. Do not run production-impacting probes or actions without authorization.
8. Add tests for unauthorized access, malformed input, privilege escalation, secret redaction, and failure paths as relevant.
9. Report evidence and residual risk. Do not claim a security audit is complete merely because a scanner passed.
