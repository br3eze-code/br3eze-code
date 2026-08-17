# AgentOS Phase 4 — Project Selection & Portfolio Intelligence

Phase 4 decides which work should receive scarce capital, people, time and infrastructure. It is a decision-support/control-plane capability, not an execution agent.

## Scoring

Every project is scored on a 0–10 criterion scale across six independent dimensions:

| Dimension | Weight |
|---|---:|
| Strategic | 20% |
| Production | 20% |
| Marketing | 15% |
| Financial | 25% |
| Personnel | 10% |
| Administration | 10% |

The weighted score is normalized to 0–100.

## Risk

Risks use probability × impact on a 1–5 scale. Risk exposure produces a bounded adjustment rather than being hidden inside the other scores. Critical risks can trigger a hard gate.

## Evidence

Scores must be supported by evidence. Missing criteria are reported explicitly and treated as zero; the engine never invents missing facts. Low evidence confidence can gate a project.

## Hard gates

A project is held when it fails minimum strategic, financial or production thresholds, has an excessive critical-risk exposure, or has insufficient evidence confidence.

Acceptance criteria are not mutable by the scoring engine.

## Decision bands

- **85–100:** PRIORITY
- **70–84:** APPROVED
- **55–69:** CONDITIONAL
- **40–54:** HOLD
- **0–39:** REJECT

Gates override score bands.

## Portfolio allocation

`allocatePortfolio()` applies the ranked decision set against explicit budget and FTE constraints. A project is executable only when it passes selection gates and its required budget and personnel capacity are available.

This deliberately prevents AgentOS from selecting five high-scoring projects and silently assuming the organization can execute all five.

## Production boundary

Phase 4 does **not**:

- execute tools;
- create purchase orders;
- hire personnel;
- approve payments;
- modify project acceptance criteria;
- replace governance authority.

It produces a governed recommendation that Phase 3 can execute through bounded work loops after an authorized decision.

## Core API

```js
import {
  scoreProject,
  rankPortfolio,
  allocatePortfolio,
  validateSelectionModel
} from '../src/core/project-selection-engine.js';
```

The model definition is configuration-driven in `config/project-selection-model.json` so weights, gates and decision bands can be reviewed without rewriting the engine.
