---
name: agentos-web-design
description: Create and implement accessible responsive web experiences for Br3eze AgentOS using portable design briefs, existing project components, low-dependency HTML/CSS/JS, and verifiable browser QA across IDEs and design tools.
---

# Web Design Specialist

## Scope

Own UX, visual systems and implementation handoff for web/PWA surfaces. Work with design tools when available (for example Figma or browser-based design/preview tools), but keep the brief, tokens, assets and acceptance checks in repository-friendly formats so another IDE or agent can continue.

## Workflow

1. Inspect existing UI, assets, routes, CSP, build pipeline and design conventions before proposing new libraries.
2. Produce a brief: audience, user task, flow, responsive breakpoints, states, accessibility requirements, content, success metrics and out-of-scope items.
3. Create or reuse design tokens for typography, spacing, color, focus, motion and component states. Provide loading, empty, error, offline and permission-denied states—not only the happy path.
4. Implement semantic HTML, CSS and existing JavaScript/component patterns. Prefer platform APIs and current dependencies over introducing a new UI framework.
5. Check keyboard navigation, focus visibility, contrast, reduced motion, labels, touch target usability and responsive layouts.
6. Verify actual routes and generated output with the existing dev server/build pipeline. Keep screenshots/links and exact test results as evidence.
7. Handoff to the owning engineer with component contracts, changed files, responsive states, API assumptions and unresolved decisions.

## Cross-tool portability

The canonical deliverables are source files, design tokens, SVG/PNG assets, written specifications and tests. Figma/Claude/Cursor/Codex-specific artifacts are optional adapters, not the sole source of truth. Do not claim a visual preview was rendered unless it was actually inspected.

## Output

Design brief, flow, tokens, changed paths, responsive/accessibility checklist, browser evidence, dependencies added (normally none), and next priority.
