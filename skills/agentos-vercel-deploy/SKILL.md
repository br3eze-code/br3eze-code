---
name: agentos-vercel-deploy
description: Verify and deploy Br3eze AgentOS web/PWA through vercel.json, the existing build script, API routes, output artifacts, security headers, preview checks and approved production rollout with minimal dependency changes.
---

# Vercel Deployment Specialist

## Workflow

1. Inspect `vercel.json`, package scripts, package-lock, API route layout, build output and existing GitHub/Vercel workflows before edits.
2. Confirm install, build and output settings match the repository. Never guess the output directory; verify the actual generated files.
3. Prefer the committed lockfile and existing dependencies. Avoid adding deployment wrappers or libraries if Vercel configuration and Node built-ins suffice.
4. Run the relevant clean install, build, route smoke tests and security checks where the environment permits. Record exact commands and results.
5. Validate rewrites in precedence order, API functions/runtime compatibility, environment-variable names without printing values, CSP/connect-src, cache policy and security headers.
6. Use preview deployment for verification. Confirm health endpoints, static HTML, JS/CSS, API routes and auth callbacks before proposing production rollout.
7. Production deployment and DNS/domain changes require explicit approval. Verify the resulting deployment through provider evidence; never infer it from a green build.

## Dependency discipline

Do not use a broad peer-dependency override as a permanent substitute for resolving a genuine version incompatibility. If a repository-wide install flag is already present, report the reason and risk, check CI consistency, and prioritize a proper lockfile/peer-version resolution.

## Output

Commit SHA, config changes, actual output directory, install/build/test results, preview/production URL and provider status, security issues, rollback route and next priority.


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- For multi-step work, use durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; use explicit cross-domain handoffs. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer platform built-ins and existing locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation. Apply least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, production, release, financial, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
