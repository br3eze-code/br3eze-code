# AgentOS Project Manager Procurement Control Model

## Executive design

The Project Manager should treat procurement as a **controlled, dependency-aware delivery stream**. Procurement identifies and structures market options; Engineering verifies technical feasibility; Design verifies user and interface fit; the Accountant verifies full cost and budget; QA verifies testability and acceptance; and the Project Manager integrates the recommendation into the WBS and routes it for approval.

The system must preserve separation of duties. A recommendation is not a purchase order, a bid is not an approval, and an agent response is not evidence.

## 1. Resource histogram

The resource histogram measures specialist demand against available capacity for each project, WBS package, role, and reporting period.

```text
tenant → project → WBS package → role → period
      → capacity → planned → committed → actual → forecast
```

| Role | Main demand profile | Histogram measure | Escalation trigger |
|---|---|---|---|
| Planner | Objective decomposition, baselines, dependencies | Planning hours per period | Critical-path work has no available planner capacity |
| Engineer | Feasibility, implementation, testing, troubleshooting | Engineering hours per period | Forecast demand exceeds qualified capacity |
| Accountant | Budget, quotes, commitments, forecasts, reconciliation | Commercial hours per period | Commercial review becomes the schedule bottleneck |
| Secretary | Meetings, decisions, controlled records, communications | Coordination hours per period | Required records are late or incomplete |
| Procurement | Requirements, tenders, evaluations, orders | Procurement hours per period | Tender or award milestone is at risk |
| Expeditor | Supplier milestones, exceptions, receipt evidence | Expediting hours per period | Delivery exception lacks an owner |
| Designer | Needs, options, prototypes, design reviews | Design hours per period | Design review blocks procurement or implementation |
| Draftsman | Drawings, diagrams, revisions, handover packs | Document-production hours per period | Current approved revision is unavailable |
| QA | Gates, inspections, defects, evidence, closeout | QA hours per period | Acceptance work is under-resourced |

A resource period should be stored as a first-class record:

```json
{
  "resourcePlanId": "RPL-001",
  "tenantId": "tenant-001",
  "projectId": "project-001",
  "wbsId": "WP-ENG-004",
  "role": "engineer",
  "periodStart": "2026-09-01",
  "periodEnd": "2026-09-07",
  "capacityHours": 40,
  "plannedHours": 24,
  "committedHours": 20,
  "actualHours": 18,
  "forecastHours": 28,
  "costRate": 75,
  "currency": "USD",
  "status": "baseline"
}
```

The service should calculate, rather than accept as trusted input, `availableHours`, `varianceHours`, utilization, and forecast cost. When forecast demand exceeds capacity, the Project Manager may resequence work, add a qualified contractor, or submit a time-cost change. It must not silently over-allocate a specialist.

## 2. Procurement-cycle WBS

| WBS package | Activity | Accountable role | Required contributors | Completion gate |
|---|---|---|---|---|
| PRO-001 | Capture purchase requirement | Procurement | Requestor, Engineer | Requirement and acceptance criteria complete |
| PRO-002 | Confirm scope and specification | Engineer | Designer, Draftsman | Technical scope approved |
| PRO-003 | Confirm budget and commercial basis | Accountant | Procurement, Project Manager | Budget and currency confirmed |
| PRO-004 | Perform buy-versus-make analysis | Procurement, Engineer | Designer, Accountant, QA | Decision record approved |
| PRO-005 | Prepare tender pack | Procurement | Engineer, Designer, Draftsman, Accountant | Controlled tender revision issued |
| PRO-006 | Invite eligible suppliers | Procurement | Secretary | Invitations and conflicts recorded |
| PRO-007 | Receive and normalize bids | Procurement | Secretary, Accountant | Bid receipt closed |
| PRO-008 | Perform technical evaluation | Engineer | Designer, QA | Technical recommendation complete |
| PRO-009 | Perform commercial evaluation | Accountant | Procurement | Commercial recommendation complete |
| PRO-010 | Prepare weighted recommendation | Procurement | Engineer, Accountant, Project Manager | Recommendation review complete |
| PRO-011 | Approve award | Authorized budget owner | Project Manager | Approval record exists |
| PRO-012 | Issue order and baseline delivery | Procurement, Expeditor | Accountant | Commitment and milestones recorded |
| PRO-013 | Inspect, receive, and close | Expeditor, QA | Engineer | Receipt and acceptance evidence complete |

The WBS package should include dependencies, deliverables, acceptance criteria, budget fields, evidence requirements, owner, approval requirement, and current controlled-document revisions.

## 3. Invite-to-tender governance

The tender lifecycle is:

```text
approved requirement
→ tender strategy
→ supplier eligibility check
→ versioned tender pack
→ invitations
→ clarification period
→ bid receipt
→ deadline closure
→ compliance screening
→ technical evaluation
→ commercial evaluation
→ delivery and risk review
→ recommendation
→ approval
→ award or re-tender
```

Each tender must retain the tenant, project, WBS package, tender-pack revision, invited suppliers, closing time, clarification log, bid reference or content hash, evaluators, conflict declarations, scoring weights, recommendation, approval, and award result.

| Control | Required behavior |
|---|---|
| Supplier eligibility | Only approved suppliers, or suppliers with a recorded exception approval, may be invited. |
| Tender-pack integrity | The exact scope, drawing, specification, and revision sent to each supplier must be retained. |
| Clarifications | Material answers must be distributed consistently to eligible bidders and linked to the tender revision. |
| Bid receipt | Late, incomplete, or altered bids must be marked according to policy rather than silently accepted. |
| Evaluation separation | Technical and commercial scores must be recorded independently before weighting. |
| Conflicts | Evaluators must declare conflicts before viewing or scoring bids. |
| Award | A purchase order or subcontract cannot be issued without an approval ID tied to the same tenant, project, and WBS. |
| Audit | State transitions, score changes, and recommendation changes create immutable change events. |

A weighted score may be calculated as:

```text
weighted score = technical score × technical weight
               + commercial score × commercial weight
               + delivery score × delivery weight
               + risk score × risk weight
```

The weights and mandatory disqualification rules must be approved before bid evaluation begins. A model may normalize arithmetic and identify missing fields, but may not invent bids, alter evidence, or override a mandatory gate.

## 4. Buy-versus-make decision

Buy-versus-make belongs in the procurement WBS, but it is a joint professional decision.

| Dimension | Buy assessment | Make assessment | Accountable role |
|---|---|---|---|
| Scope fit | Does a market option satisfy the approved specification? | Can the team build the approved result without uncontrolled scope growth? | Engineer |
| Design fit | Does the product support the approved user and interface design? | Does internal work preserve usability and maintainability? | Designer |
| Full cost | Purchase, delivery, integration, licensing, training, support, and change cost | Design, labour, materials, tooling, testing, support, opportunity, and rework cost | Accountant |
| Time | Supplier lead time, delivery, integration, and stabilization | Design, build, test, and stabilization duration | Planner / Procurement |
| Quality | Warranty, certification, supplier quality, and acceptance evidence | Ability to reproduce, test, and support quality | QA |
| Security | Supplier controls, dependencies, access, and data exposure | Internal dependency, access, and maintenance controls | Engineer / QA |
| Availability | Replenishment, service, and parts availability | Skills, parts, tools, and long-term ownership availability | Procurement / Expeditor |
| Flexibility | Supplier-specific change cost and lock-in | Internal adaptation cost and technical debt | Engineer |
| Risk | Contractual, supplier, delivery, and obsolescence risk | Execution, staffing, support, and failure risk | Project Manager / Accountant |

The comparison should calculate full cost rather than comparing only the purchase price:

```text
buy total cost = quoted price + delivery + integration + licensing
               + training + support gap + expected change cost
               + expected failure cost

make total cost = design labour + implementation labour + materials
                + tooling + tests + support + opportunity cost
                + expected rework cost + expected failure cost
```

The decision record should contain at least two options, evidence references, total cost, duration, technical score, quality score, risk score, assumptions, sensitivity range, recommendation, and approval state.

## 5. Safety gates

| Gate | Minimum evidence | Required owner or approver |
|---|---|---|
| Scope | Approved requirement, WBS link, acceptance criteria | Project Manager and requestor |
| Technical | Specification, compatibility, feasibility, constraints | Engineer |
| Design | Approved interface and user/service impact review | Designer |
| Commercial | Budget reference, normalized costs, forecast impact, currency | Accountant |
| Supplier | Supplier status, eligibility, due diligence, conflict declaration | Procurement |
| QA | Test method, defect policy, acceptance and evidence plan | QA |
| Decision | Buy-versus-make comparison and recommendation | Project Manager |
| Commitment | Approval ID, PO or subcontract draft, idempotency key | Authorized budget owner |
| Receipt | Delivery record, inspection, test, and acceptance evidence | Expeditor and QA |

A failed gate changes the WBS package to `blocked` or `rejected`. It must not be bypassed by reassigning the package to another agent.

## 6. Recommended schema additions

Add these tenant-scoped tables to the WBS and commercial schema:

```text
pm_resource_plans
pm_resource_periods
pm_tenders
pm_tender_suppliers
pm_tender_clarifications
pm_tender_bids
pm_tender_evaluations
pm_buy_make_decisions
pm_buy_make_options
pm_procurement_approvals
```

Every table must include `tenant_id`. Every relation to a project, WBS package, subcontractor, tender, bid, or approval should use a composite foreign key containing `tenant_id`. This prevents tenant A from attaching a procurement record to tenant B’s project or WBS package.

### Buy-versus-make record

```json
{
  "decisionId": "BMD-001",
  "tenantId": "tenant-001",
  "projectId": "project-001",
  "wbsId": "WP-PRO-004",
  "status": "approved",
  "decision": "buy",
  "currency": "USD",
  "options": [
    {
      "type": "buy",
      "supplierId": "SUP-001",
      "totalCost": 18400,
      "durationDays": 12,
      "technicalScore": 86,
      "qualityScore": 90,
      "riskScore": 78,
      "evidenceRefs": ["EVD-101", "EVD-102"]
    },
    {
      "type": "make",
      "totalCost": 22100,
      "durationDays": 27,
      "technicalScore": 94,
      "qualityScore": 82,
      "riskScore": 64,
      "evidenceRefs": ["EVD-103", "EVD-104"]
    }
  ],
  "recommendationReason": "Buy meets the approved specification within the required delivery window and has stronger warranty evidence.",
  "approvedBy": "user-approver-001"
}
```

## 7. Agent responsibility contract

```text
Procurement finds suppliers, manages tenders, and structures bids.
Engineer verifies feasibility, compatibility, and technical risk.
Designer verifies user, service, and interface fit.
Accountant verifies full cost, budget, commitments, and forecast.
QA verifies testability, acceptance, defects, and evidence.
Expeditor tracks delivery, exceptions, receipt, and supplier milestones.
Project Manager integrates the WBS, histogram, recommendation, and approvals.
```

The Project Manager is therefore the **coordination authority**, not the sole technical or commercial authority. A material purchase, subcontract, implementation, change, or acceptance must remain linked to an approved WBS package, controlled document revision, responsible specialist, evidence record, and explicit approval state.
