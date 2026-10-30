# General-purpose Transformer lab (Node.js)

This is a small, dependency-free, decoder-only Transformer reference implementation. It supports configurable vocabulary size, context window, model width, attention heads, layer count and feed-forward width; causal self-attention; autograd; AdamW; deterministic sampling; JSON checkpoints; and native checkpoint fine-tuning.

It is an **educational CPU/Float64 model**, not a pretrained foundation model and not a production-quality chat model. It is kept separate from AgentRuntime until it has a stable model-provider contract and realistic quality/performance evaluation.

## Requirements

- Node.js 22+
- No additional npm dependencies for training or verification

## Train a model from text

Use UTF-8 text you have permission to use. The included tiny-corpus.txt is only a smoke-test fixture.

```bash
npm run train:transformer -- --input experiments/llm-js/fixtures/tiny-corpus.txt --depth 2 --context 4 --steps 20 --generate 40 --checkpoint /tmp/general-transformer.json
```

Or configure the architecture explicitly:

```bash
npm run train:transformer -- --input path/to/approved.txt --context 32 --width 16 --heads 4 --layers 2 --hidden 64 --steps 500 --checkpoint ./artifacts/model.json
```

Depth presets are convenience settings, not compute-optimal hyperparameters. Small corpora can produce misleading validation results; use representative held-out data before drawing conclusions.

## Fine-tune a checkpoint

```bash
npm run finetune:transformer -- --checkpoint ./artifacts/model.json --input path/to/approved.txt --steps 50 --lr 0.0005 --output ./artifacts/model-finetuned.json
```

The text must use characters already present in the checkpoint vocabulary. If it contains new characters, retrain/extend the tokenizer first. Fine-tuning is local and does not upload data.

## Verify learning and checkpoints

```bash
npm run verify:transformer
```

The verification checks deterministic next-token learning on a synthetic corpus, held-out loss improvement, checkpoint round-trip behavior and optimizer-state preservation. It is a regression smoke test, not a benchmark of general language ability.

## Architecture boundary

The Transformer is a model/training subsystem, not an agent runtime. It does not register tools, execute commands, access hardware or bypass AgentRuntime authorization. A future production model adapter must define bounded inference, context/token limits, cancellation, error handling and explicit runtime registration.
