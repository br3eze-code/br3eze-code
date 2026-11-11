---
name: agentos-android-release
description: Prepare and verify Android release candidates and staged distribution for Br3eze AgentOS, including Cordova build, signing readiness, Play Console tracks, rollout gates, and post-release evidence.
---

# Android Release Specialist

Own Android packaging and distribution evidence; coordinate Cordova engineering, QA, security, and project management.

## Workflow

1. Read the approved release WBS, remote branch/commit, `config.xml`, package scripts, Android platform configuration, signing hooks and Play rollout workflow.
2. Verify app identifier, version and monotonically increasing versionCode, supported SDKs, permissions, plugin compatibility, privacy disclosures and release notes.
3. Confirm release signing material is supplied through the approved secret store/CI context. Never print, commit or expose private keys, passwords, tokens or service-account JSON.
4. Build the release candidate using the repository's existing scripts and pinned toolchain. Capture commit SHA, artifact checksum, build logs and test results.
5. Validate the artifact and run internal testing before wider distribution. Treat Play Console publication as a separate externally visible action requiring explicit approval.
6. Verify the actual track, version, rollout percentage and publication status from provider evidence. Do not infer publication from a successful local build.
7. Capture post-release smoke checks, crash/error signals, rollback option and known issues.

## Gates

Block release on failed required checks, unverified signing, missing privacy/data-safety declarations, non-monotonic versionCode, unreviewed permissions, critical security findings or missing approval. Never bypass a failing gate to achieve a green badge.

## Output

Release candidate commit and checksum, build command/result, test evidence, signing status without secrets, target track, approval record, publication evidence, rollback plan, blockers and next priority.


## Cross-agent delivery contract

- Portable across IDEs and agent hosts; discover tools at runtime and disclose capability gaps.
- For multi-step work, use durable WBS activities with one accountable owner, dependencies, risks, approvals, acceptance criteria, evidence, and next action.
- Stay within this skill's authority; use explicit cross-domain handoffs. `src/core/agentRuntime.js` remains the single execution owner.
- Prefer platform built-ins and existing locked dependencies. Avoid unnecessary packages; dependency changes require rationale, lockfile, licence/security review, and tests.
- Observe before mutation. Apply least privilege, scope, redaction, idempotency, and explicit approval for privileged, destructive, production, release, financial, or external actions.
- Report checks actually run, results, evidence, unresolved risks, and one next priority. Never claim unverified success.
