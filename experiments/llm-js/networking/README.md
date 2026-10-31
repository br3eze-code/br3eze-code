# TinyGPT RouterOS research loop (simulation-first)

## Goal and boundary

This first vertical slice measures root-cause diagnosis for simulated MikroTik RouterOS incidents. It is not a RouterOS API client and does not change production routers.

The canonical execution owner remains `src/core/agentRuntime.js`. The networking module exports tool descriptors and diagnostic functions only; it does not instantiate an AgentRuntime, own task lifecycle, bypass `ToolRegistry`, or create a second model/tool loop. Compose the exported descriptors into the existing ToolRegistry using the repository's normal registration path, then let AgentRuntime enforce tenant identity, ToolPolicy, approvals, task lifecycle and execution.

The current TinyGPT implementation is a small character-level educational language model. Do not treat it as a reliable network diagnostician by itself. The deterministic diagnostic baseline is the oracle for this first milestone. A future model-assisted ranker can propose hypotheses, while deterministic evidence checks and the independent evaluator remain authoritative.

## Modules

- `networking/routeros-lab.js`: fault-injected lab state, read-only tool descriptors, evidence collection, transparent baseline diagnosis and evaluation.
- `routeros-networking.test.js`: regression tests run by the existing Node 22 LLM workflow.
- `networking/README.md` (this file): implementation contract, schemas, gates and learning plan.

## Simulated incidents

The evaluator runs five scenarios: healthy, WAN link down, missing default route, exhausted DHCP pool, and DNS misconfiguration. Each scenario has private ground truth. Tool outputs never include the hidden fault label; the label is accessed only by the test/evaluation harness after the diagnosis has been made.

Evidence schema (simplified):

```json
{
  "interfaces": [{ "name": "ether1-wan", "running": true, "role": "wan" }],
  "routes": [{ "dst": "0.0.0.0/0", "gateway": "198.51.100.1", "active": true }],
  "dhcp": {
    "serverRunning": true,
    "poolCapacity": 100,
    "activeLeases": 18,
    "offersObserved": true
  },
  "dns": {
    "allowRemoteRequests": true,
    "servers": ["192.0.2.53"],
    "resolutionWorks": true
  },
  "probes": {
    "gateway": { "target": "gateway", "reachable": true },
    "publicIp": { "target": "public-ip", "reachable": true },
    "dnsName": { "target": "dns-name", "reachable": true }
  }
}
```

Diagnosis result schema:

```json
{
  "diagnosis": "dns-misconfigured",
  "confidence": 0.96,
  "hypotheses": [
    {
      "id": "dns-misconfigured",
      "score": 0.96,
      "reasons": [
        "Public IP connectivity works",
        "DNS resolution fails",
        "DNS configuration is incomplete or failing"
      ]
    }
  ],
  "evidenceRefs": [{ "id": "E1", "reason": "Public IP connectivity works" }],
  "recommendation": "Confirm the supporting observations and test the suspected cause in the isolated lab before proposing a change.",
  "proposedChanges": []
}
```

A case record for future reviewed learning data should add: `caseId`, `schemaVersion`, `createdAt`, sanitized `symptom`, topology metadata, evidence and timestamps, hypotheses, selected tests, diagnosis, verifier result, human review status, source references, and an explicit `split` value (`train`, `validation`, or `test`). Never store secrets, router credentials, customer identifiers, or unredacted public IPs in training examples. Keep hidden ground truth in evaluator-only fields, not in model prompts or retrieval documents.

## Read-only tool contract

Current allowlist:
- `routeros.getInterfaces`
- `routeros.getRoutes`
- `routeros.getDhcp`
- `routeros.getDns`
- `routeros.probeConnectivity` with target `gateway | public-ip | dns-name`

Each descriptor declares `risk: "read-only"` and `permissions: ["network:read"]`. There are intentionally no configuration-write, reboot, firewall, DHCP mutation, credential, shell, or arbitrary RouterOS command tools. JSON Schema validates tool inputs; authorization must still be enforced by AgentRuntime/ToolPolicy. A tool's self-declared risk is metadata, not authorization.

When a real RouterOS adapter is introduced, use a dedicated least-privilege account, explicit command allowlists, command/output/time limits, secret redaction, and read-only credentials. Start with a simulator. Never point test fault injection at a live router.

## Evaluation metrics and gates

The suite reports:
- **Top-1 accuracy**: exact primary root-cause match.
- **Top-3 accuracy**: expected cause appears in the first three hypotheses.
- **Evidence-grounding rate**: diagnosis has supporting evidence references, or explicitly reports insufficient evidence.
- **Mean confidence**: diagnostic confidence averaged over the suite; this is descriptive, not a calibration claim.

Current synthetic suite acceptance: 100% top-1 and top-3 accuracy, 100% evidence-grounding rate, no hidden-label leakage, and zero write-capable tools. This tiny five-case suite proves wiring and known scenarios only; it does not establish real-world RouterOS accuracy. Before calling the objective production-ready, expand to at least 100 independently designed incidents, hold out whole fault families/configuration variants, add noisy and conflicting evidence, and report per-class precision/recall, confusion matrix, abstention rate, Brier score or expected calibration error, and diagnosis latency. Set thresholds only after a baseline is measured on the held-out set.

## Controlled self-improvement

1. Research: index versioned MikroTik documentation and reviewed runbooks with source URL, version/date, affected RouterOS release and a short claim-level citation. Retrieval supplies context; it is not proof that a hypothesis is true.
2. Investigate: AgentRuntime plans a bounded sequence of read-only tests; the model can suggest the next test, but only allowlisted tools execute.
3. Verify: compare the diagnosis with independent lab truth and check that predicted symptoms match the evidence.
4. Review: persist sanitized traces as *candidate* cases. A human or trusted lab verifier approves labels and fixes before training inclusion.
5. Evaluate: use frozen, held-out cases and compare the candidate against the current baseline. Prevent incident variants from crossing train/test splits.
6. Promote: only promote a checkpoint if held-out diagnosis metrics improve without regressions, confidence is acceptably calibrated, and all security/regression tests pass. Keep the previous checkpoint for rollback.

Learning from its own unverified answers would amplify mistakes. Store observations and outcomes first; fine-tune only on reviewed traces. A smaller model should not be fine-tuned on five synthetic examples and described as having learned networking.

## Run

```bash
node --test experiments/llm-js/*.test.js
```

The current CI glob includes `routeros-networking.test.js`. The local simulation can be extended by adding a fault, evidence fields, deterministic diagnosis rules and a test for both correct identification and evidence isolation.
