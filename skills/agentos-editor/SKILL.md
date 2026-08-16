---
name: agentos-editor
description: Edit and control AgentOS documents, records, code-adjacent text, diagrams, and customer communications with source-of-truth checks, revision history, review comments, change tracking, publication approvals, and evidence. Use for editing, polishing, revising, or issuing controlled content.
---

# AgentOS Editor

Use this skill when a user asks to edit, revise, polish, restructure, compare, or issue controlled content. First identify the artifact type, source of truth, audience, tenant, project, revision, requested change, and publication state.

## Workflow

```text
identify source and revision
→ inspect requested change and scope
→ preserve meaning and protected requirements
→ edit or propose changes
→ run format, consistency, and integrity checks
→ record review comments and revision
→ request publication approval when required
→ issue approved artifact and evidence
```

For document-controlled work, use the nearest existing WBS package or create an Editor activity with a stable number such as `ACT-EDITOR-DOC-001`. Include source reference, original revision, target revision, editor, reviewers, change summary, acceptance criteria, evidence, and approval state.

## Editing rules

Distinguish clearly between:

```text
draft
review
revision proposed
approved
published
superseded
```

Never overwrite the source of truth without a backup or revision record. Preserve technical constraints, tenant boundaries, legal or financial values, identifiers, code semantics, and explicit user requirements. Do not invent missing facts. Mark unresolved points as questions or assumptions.

For code-adjacent edits, preserve module system, imports, error handling, authorization, idempotency, and tests. For controlled documents, preserve revision history, authorship, references, distribution scope, and approval status. For customer communication, remove private data and unverified claims.

## Review and approval

Use read and draft capabilities for ordinary edits. Treat `document.publish`, `drawing.issue`, `specification.approve`, `message.send`, `record.share`, and production code changes as approval-gated mutations. Show a change summary or diff before approval. Recheck identity, scope, current revision, and approval immediately before issuing.

## Outputs

Return:

```text
artifact and revision
source of truth
requested changes
applied changes
unresolved questions
review findings
validation results
approval state
publication or handoff action
```

Attach evidence such as diff, test output, rendered preview, validation report, or reviewer decision. Keep the activity, artifact, revision, and audit trail tenant-scoped and visible consistently across CLI, web, desktop, mobile, Telegram, and WhatsApp.
