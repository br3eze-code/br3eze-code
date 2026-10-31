# RouterOS dataset preparation (research patch)

This is the next data-quality layer for the simulated RouterOS diagnosis work. It is deliberately separate from the canonical Node.js AgentRuntime and uses Python's standard library so the corpus can be prepared before selecting a GPU training stack.

## What it does

- Scans text-like repository/docs files while skipping common generated/vendor directories and obvious secret files.
- Redacts common credential/token patterns and IPv4 addresses before writing retrieval candidates.
- Deduplicates normalized document content by SHA-256 and preserves relative source paths and hashes.
- Requires diagnostic cases to be explicitly reviewed and approved; it does not manufacture labels from documentation.
- Enforces one split per fault family/root cause to reduce train/test leakage.
- Writes a manifest, a retrieval corpus, and train/validation/test JSONL case files.

Every document is tagged `licenseStatus: REVIEW_REQUIRED`. Review licensing/provenance before training or redistributing anything. Sanitization is not a guarantee that secrets or personal data are absent; inspect outputs before uploading to Lightning.ai.

## Case contract

Each line of the input cases JSONL must contain:

```json
{
  "schemaVersion": "1.0",
  "caseId": "dns-variant-001",
  "domain": "networking",
  "platform": "mikrotik-routeros",
  "task": "root-cause-diagnosis",
  "faultFamily": "dns-resolution",
  "input": { "symptom": "IP connectivity works but names fail", "evidence": {} },
  "target": {
    "rootCause": "dns-misconfigured",
    "supportingEvidence": ["Public IP probe succeeds", "DNS lookup fails"],
    "nextTest": "Query the configured resolver directly"
  },
  "verification": {
    "source": "isolated-simulator",
    "causeConfirmed": true,
    "recoveryConfirmed": true
  },
  "reviewStatus": "approved",
  "split": "train"
}
```

The example is a schema illustration, not a real incident. Use `reviewStatus: approved` only after independent lab verification or human review. Ambiguous cases should target `insufficient-evidence`, not a guessed cause. Keep credentials and hidden simulator labels out of the model input.

## Run locally

From the repository root:

```bash
python experiments/llm-js/networking/ml/prepare_dataset.py \
  --corpus-root . \
  --cases path/to/reviewed-cases.jsonl \
  --output-dir /tmp/br3eze-routeros-dataset

python -m unittest experiments/llm-js/networking/ml/test_prepare_dataset.py
```

The case input is intentionally external until enough cases have been independently reviewed; the five initial simulator scenarios are a wiring smoke test, not a valid benchmark for a week-long GPU run. In particular, do not split near-identical variants of the same fault family across train and test. Create independent fault families/configuration variants and freeze the test set before model experiments.

## Training boundary

The corpus is retrieval material, not automatically next-token training data. For diagnosis behavior, use supervised examples with evidence, answer targets, supporting evidence, next-test selection, and abstention labels. Compare a retrieval-only baseline against a suitable pretrained open-weight model with retrieval and supervised fine-tuning. Do not spend the full 8×H100 week until a small smoke run confirms data quality, tokenizer compatibility, loss behavior, distributed setup, checkpoint restore, and evaluation reproducibility.

Training/inference code must not run real-router writes. The canonical AgentRuntime remains the sole execution owner; a model may propose hypotheses/tests, but read-only tool allowlists and policy checks control execution.
