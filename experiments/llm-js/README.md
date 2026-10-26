# llm-js: a small language-model training lab

This directory has **two different learning paths**:

1. **Train our own tiny model from random initialization** with dependency-free Node.js code.
2. **Fine-tune an existing pretrained model** with a Node.js CLI and an optional Python/PyTorch/Transformers/PEFT backend.

The project is inspired by Andrej Karpathy's educational language-model work, especially `llm.c`, `makemore`, and `nanoGPT`. This is original educational code, not a line-for-line port of their source and not a competitive general-purpose LLM.

## Requirements

- Node.js 22+ for the educational model and CLI.
- No third-party packages or GPU required for the educational TinyGPT path.
- Pretrained fine-tuning additionally requires Python, compatible PyTorch, Transformers, PEFT, Accelerate, access to the selected base model, and enough RAM/VRAM.

## 1. Train our own TinyGPT

Train the bigram baseline:

```bash
node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42
```

Train the decoder-only Transformer:

```bash
node experiments/llm-js/train-gpt.js --steps 100 --context 16 --width 8 --heads 2 --layers 2 --hidden 32 --lr 0.01 --seed 42
```

The general Transformer trainer also supports nanochat-inspired depth-first sizing:

```bash
node experiments/llm-js/train-transformer.js --depth 2 --context 16 --steps 100 --seed 42
node experiments/llm-js/train-transformer.js --depth 6 --context 32 --steps 100 --seed 42
```

`--depth 1..8` derives width, attention-head count, layer count, and feed-forward width from one setting. This CPU reference preset is deliberately capped at width 32; it is a usability pattern, not a claim of compute-optimal hyperparameters. Explicit `--width`, `--heads`, `--layers`, and `--hidden` options remain available when you want to control the architecture.

Use `--input path/to/text.txt` to train on UTF-8 text you have permission to use. The CLI uses a simple sequential 90/10 train/validation split, reports held-out validation loss before and after training, generates a sample, and saves model weights, AdamW moments, and the character vocabulary. Tiny corpora make weak validation sets; use larger representative data for meaningful evaluation.

Options include `--steps`, `--context`, `--width`, `--heads`, `--layers`, `--hidden`, `--lr`, `--seed`, `--generate`, `--input`, `--resume`, and `--checkpoint`.

## 2. Fine-tune a pretrained model (LoRA)

This path starts with an **existing pretrained causal language model**. It does not start from our random TinyGPT weights. The Node.js CLI validates your JSONL dataset and launches a small Python bridge that uses Hugging Face Transformers + PEFT to train Low-Rank Adaptation (LoRA) weights. It saves the adapter and tokenizer separately from the original base model, plus evaluation metadata.

### Install optional backend dependencies

Use a virtual environment and choose a PyTorch build appropriate for your hardware:

```bash
python -m venv .venv
# Activate .venv, then:
python -m pip install -r experiments/llm-js/finetune-requirements.txt
```

### Prepare JSONL data

Each non-empty line must be one JSON object in one of these formats:

```json
{"prompt":"What is validation?","completion":"Validation evaluates a model on held-out examples."}
{"text":"A plain text sample for continued causal-language-model training."}
{"messages":[{"role":"user","content":"Hello"},{"role":"assistant","content":"Hi there."}]}
```

The `messages` format requires a tokenizer with a chat template. Use lawful, representative examples; do not put secrets or personal data in training records. A tiny example dataset is included at `experiments/llm-js/fixtures/fine-tune.jsonl`, but it is only a format/demo fixture and is far too small to meaningfully improve a model.

### Run fine-tuning

```bash
node experiments/llm-js/finetune-pretrained.js \
  --model <hugging-face-model-id-or-local-path> \
  --input experiments/llm-js/fixtures/fine-tune.jsonl \
  --steps 20 \
  --output artifacts/br3eze-adapter
```

Useful options: `--max-length`, `--batch-size`, `--grad-accum`, `--rank`, `--lr`, `--python`, and `--output`. If your Python executable is named `python3`, pass `--python python3`. This general pretrained-model path is `finetune-pretrained.js`; `finetune.js` is the native TinyGPT checkpoint path documented below.

The current backend targets common Llama/Mistral/Qwen-style attention projection names (`q_proj`, `k_proj`, `v_proj`, `o_proj`). Some model families need different target modules or a different backend. Review the base model's license, gated-model access requirements, resource needs, and dataset rights before running.

**Important:** LoRA fine-tuning updates a small adapter rather than all base-model weights. It can specialize a pretrained model for a task, but it does not create a new foundation model, guarantee improved quality, or automatically connect the model to AgentOS. The Python bridge is deliberate: practical pretrained-model training currently relies on the PyTorch/Transformers ecosystem; the CLI, validation and workflow orchestration remain Node.js.

## Open-weight model harness (Node.js)

`harness.js` is the provider-neutral inference boundary. It talks to any local or remote server that implements the OpenAI-compatible `/v1/chat/completions` API; the server loads and executes the model, while Br3eze owns routing and orchestration. It includes request validation, timeout/abort support, normalized outputs, token streaming, and a logical-name registry.

### 1. Start an open model server

Install a runtime such as llama.cpp or vLLM separately and download a model whose license and hardware requirements suit your use. For example, with a llama.cpp build and a compatible GGUF file, start its server on loopback using the server's supported model and port options. Keep the model server bound to localhost unless you have configured authentication and network access controls.

### 2. Call it from Node.js

```js
import { createOpenAICompatibleAdapter, ModelHarness } from "./experiments/llm-js/harness.js";

const harness = new ModelHarness().register(
  "local-reasoner",
  createOpenAICompatibleAdapter({
    baseUrl: process.env.MODEL_BASE_URL ?? "http://127.0.0.1:8080/v1",
    model: process.env.MODEL_ID ?? "local-model",
    apiKey: process.env.MODEL_API_KEY
  })
);

const answer = await harness.generate("local-reasoner", {
  messages: [
    { role: "system", content: "Be accurate. State uncertainty instead of inventing facts." },
    { role: "user", content: "Explain what a model harness does." }
  ],
  temperature: 0.2,
  maxTokens: 256
});
console.log(answer.text);

// Streaming is also supported:
for await (const piece of harness.stream("local-reasoner", {
  messages: [{ role: "user", content: "Explain LoRA briefly." }],
  maxTokens: 128
})) process.stdout.write(piece);
```

Run the contract tests with `node --test experiments/llm-js/harness.test.js`. These use a mocked HTTP server response and do not download model weights.

To verify a real running model server (no mock), run:

```bash
MODEL_BASE_URL=http://127.0.0.1:8080/v1 MODEL_ID=local-model node experiments/llm-js/smoke-open-model.js --prompt "Say hello in one sentence."
```

Set `MODEL_API_KEY` only if your server requires a bearer token. The smoke test reports the endpoint, served model, elapsed time, usage metadata, and generated text; it fails with a useful error if the endpoint is unreachable or rejects the request. It does not launch the server or download model weights.

### 3. Keep training and inference separate

- `finetune-pretrained.js` orchestrates LoRA fine-tuning of compatible Hugging Face causal language models via the optional Transformers/PEFT backend.
- The saved output is an **adapter**, not a standalone model. Record the exact base model/revision and tokenizer alongside it; inference must load the base model and apply that adapter using a compatible runtime.
- `harness.js` currently consumes an already-running inference endpoint. It does not load GGUF/safetensors weights directly, run a training job, execute tools, or enforce AgentOS authorization by itself.
- `finetune.js`, `gpt.js`, and the tensor/autograd files remain the educational, pure-JavaScript TinyGPT path.

### 4. Production harness boundaries

Keep a stable internal request/response contract independent of backend-specific APIs. Next layers should be added behind the contract: model metadata and capability discovery, context-window budgeting, retry policy for transient failures, request IDs/telemetry, adapter-aware loading, evaluation gates, and explicit tool-call validation/authorization. Do not allow model-generated tool names or arguments to execute directly without schema validation and AgentOS permission checks. Keep secrets in environment/secret management, not model manifests or logs.

## Native Node.js TinyGPT checkpoint fine-tuning

The dependency-free path below fine-tunes a compatible TinyGPT checkpoint created by `train-gpt.js`. The checkpoint must include the original character vocabulary; this implementation rejects unseen characters rather than silently changing token IDs.

```bash
node experiments/llm-js/train-gpt.js --input data/base.txt --steps 300 --context 32 --width 16 --heads 2 --layers 2 --hidden 64 --checkpoint artifacts/base.json
node experiments/llm-js/finetune.js --checkpoint artifacts/base.json --input data/domain.txt --steps 100 --lr 0.001 --output artifacts/domain.json
node experiments/llm-js/finetune.js --checkpoint artifacts/base.json --input data/domain.txt --unfreeze-head-only --steps 100 --output artifacts/head-only.json
node experiments/llm-js/finetune.js --checkpoint artifacts/base.json --input data/domain.txt --freeze-base --steps 100 --output artifacts/frozen-base.json
```

Here `--checkpoint` is the input model and `--output` is the resulting checkpoint. `--freeze-base` and `--unfreeze-head-only` are mutually exclusive. The importer accepts this repository's checkpoint format and compatible state-dictionary tensors, validates shapes and can transpose rank-2 matrices. It does not load arbitrary safetensors or make architecture differences disappear: fused QKV, different normalization layouts, tokenizer mappings and vocabulary sizes require an explicit adapter.

LoRA is not implemented in this TinyGPT path: adapter-aware Q/V hooks have not yet been added to the decoder forward graph. For general Hugging Face pretrained models, the separate `finetune-pretrained.js` CLI retains the optional Transformers/PEFT LoRA workflow.

## Tests

```bash
node --test experiments/llm-js/*.test.js
```

The Node 22 GitHub Actions workflow runs the educational model tests and CLI smoke tests. It does not download a pretrained model or exercise LoRA training; that path still needs a manual small-model test in an environment with compatible dependencies and hardware.

## Implemented in the educational path

- Character vocabulary and bigram baseline with stable softmax, cross-entropy, analytic gradients, SGD and JSON checkpoints.
- Float64 tensor operations and reverse-mode automatic differentiation.
- Embedding lookup, differentiable slicing/concatenation, linear layers, layer normalization and stable softmax/cross-entropy.
- Causal multi-head attention, learned token/position embeddings, residual connections and feed-forward blocks.
- Configurable decoder-only TinyGPT, gradient clipping, AdamW, deterministic sampling, validation loss and model-plus-optimizer checkpoint/resume.
- Depth-first Transformer sizing preset derived from the nanochat “one complexity dial” pattern, with input validation and unit tests.

- Native Transformer checkpoint fine-tuning with named parameters, head-only or frozen-base policies, fresh optimizer moments, and regression tests.

Fine-tune a checkpoint produced by `train-transformer.js` using a corpus that stays within the checkpoint's character vocabulary:

```bash
node experiments/llm-js/train-transformer.js --input experiments/llm-js/fixtures/tiny-corpus.txt --depth 2 --context 4 --steps 20 --checkpoint artifacts/base-transformer.json
node experiments/llm-js/finetune-transformer.js --checkpoint artifacts/base-transformer.json --input experiments/llm-js/fixtures/tiny-corpus.txt --steps 20 --lr 0.001 --output artifacts/finetuned-transformer.json
node experiments/llm-js/finetune-transformer.js --checkpoint artifacts/base-transformer.json --input experiments/llm-js/fixtures/tiny-corpus.txt --unfreeze-head-only --steps 20 --output artifacts/head-only-transformer.json
node experiments/llm-js/finetune-transformer.js --checkpoint artifacts/base-transformer.json --input experiments/llm-js/fixtures/tiny-corpus.txt --freeze-base --steps 20 --output artifacts/frozen-base-transformer.json
```

`--freeze-base` trains the output head and final normalization parameters; `--unfreeze-head-only` trains only the output projection and bias. The flags are mutually exclusive. Fine-tuning resets Adam moments rather than carrying over pretraining momentum. The character vocabulary is intentionally fixed: unknown characters are rejected rather than assigned incompatible token IDs.

## Important limits

TinyGPT is a correctness-first CPU learning implementation, not a production or pretrained general-purpose LLM. It uses character-level tokens, small context windows and a pure-JavaScript Float64 tensor engine. It lacks a BPE tokenizer, dropout, mature shuffled mini-batching, broad gradient checks, optimized kernels, GPU acceleration and distributed training. The pretrained-model LoRA path is a separate optional backend and has not yet been verified end-to-end in this repository environment.

## Relationship to Karpathy's work

- `llm.c` is a low-level C/CUDA training and performance-engineering reference.
- `makemore` and `nanoGPT` are useful educational references for language-model structure and training loops.
- This project translates those learning goals into original JavaScript and an optional standard pretrained fine-tuning bridge. Node.js CPU tensor code should not be expected to match CUDA performance.
