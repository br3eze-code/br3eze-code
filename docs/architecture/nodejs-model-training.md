# Node.js model training in AgentOS

AgentOS now has an optional, domain-neutral baseline for training a small numeric-feature classifier with TensorFlow.js. This is a first practical training pipeline, not a large language model (LLM), and it does not replace the canonical AgentRuntime or its model port.

## Requirements

- Node.js 22 or newer.
- Install dependencies with `npm install`.
- The training dependency is pure JavaScript TensorFlow.js. It avoids requiring a native TensorFlow binding, but CPU training can be slower.

## Train the sample

```bash
npm run model:train
```

Equivalent explicit command:

```bash
node scripts/train-model.mjs --data examples/model-training/triage.jsonl --out artifacts/br3eze-classifier --epochs 80
```

The sample data is synthetic and demonstrates three labels. Replace it with examples that match your task before relying on predictions. Do not use personal, customer, or network data unless you have permission and a clear retention policy.

## Dataset format

Use JSON Lines (one JSON object per line). Every row has a same-length numeric `features` array and a non-empty string `label`:

```json
{"features":[0.1,0.4,0.8],"label":"low"}
{"features":[0.8,0.7,0.2],"label":"high"}
```

At least six examples and two distinct labels are required. For meaningful results, collect many representative examples per label and keep a separate held-out test dataset for evaluation. The built-in validation metric is an initial signal, not proof of generalisation.

## Predict

After training:

```bash
npm run model:predict -- --features 0.8,0.7,0.2
```

Or select another artifact directory:

```bash
node scripts/predict-model.mjs --model artifacts/br3eze-classifier --features 0.8,0.7,0.2
```

The output contains the predicted label and per-class confidence scores. These scores are model outputs, not guaranteed probabilities of correctness.

## Artifact format and lifecycle

- `model.json` stores the network topology, weight specifications, and versioned metadata.
- `weights.bin` stores trained weight values.
- Model artifacts are generated locally and are not committed to Git by default. Keep private training data out of the repository; review artifact licensing and data provenance before distributing a trained model.
- Train and evaluate candidates separately before promoting an artifact. Never let model predictions bypass AgentOS tool authorization, tenant boundaries, or runtime verification.

## Relationship to the model port

This classifier returns a label and scores; it is not a conversational model and does not implement `src/core/ports/model.js`'s completion contract. It can become a routing or classification capability behind the existing runtime. For a locally hosted chat model, use the existing configured provider path (for example the local/Ollama adapter) or add a separately tested adapter implementing the model port. LLM fine-tuning requires a pretrained language model and a compatible training backend; this classifier is not that.

## Commands

- `npm run model:train` — train the sample or a supplied JSONL dataset.
- `npm run model:predict -- --features 0.8,0.7,0.2` — infer with the saved artifact.
- `npm test -- --runInBand tests/unit/trainable-classifier.test.js` — run dataset-contract tests.
