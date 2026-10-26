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
node experiments/llm-js/finetune.js \
  --model <hugging-face-model-id-or-local-path> \
  --input experiments/llm-js/fixtures/fine-tune.jsonl \
  --steps 20 \
  --output artifacts/br3eze-adapter
```

Useful options: `--max-length`, `--batch-size`, `--grad-accum`, `--rank`, `--lr`, `--python`, and `--output`. If your Python executable is named `python3`, pass `--python python3`.

The current backend targets common Llama/Mistral/Qwen-style attention projection names (`q_proj`, `k_proj`, `v_proj`, `o_proj`). Some model families need different target modules or a different backend. Review the base model's license, gated-model access requirements, resource needs, and dataset rights before running.

**Important:** LoRA fine-tuning updates a small adapter rather than all base-model weights. It can specialize a pretrained model for a task, but it does not create a new foundation model, guarantee improved quality, or automatically connect the model to AgentOS. The Python bridge is deliberate: practical pretrained-model training currently relies on the PyTorch/Transformers ecosystem; the CLI, validation and workflow orchestration remain Node.js.

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

## Important limits

TinyGPT is a correctness-first CPU learning implementation, not a production or pretrained general-purpose LLM. It uses character-level tokens, small context windows and a pure-JavaScript Float64 tensor engine. It lacks a BPE tokenizer, dropout, mature shuffled mini-batching, broad gradient checks, optimized kernels, GPU acceleration and distributed training. The pretrained-model LoRA path is a separate optional backend and has not yet been verified end-to-end in this repository environment.

## Relationship to Karpathy's work

- `llm.c` is a low-level C/CUDA training and performance-engineering reference.
- `makemore` and `nanoGPT` are useful educational references for language-model structure and training loops.
- This project translates those learning goals into original JavaScript and an optional standard pretrained fine-tuning bridge. Node.js CPU tensor code should not be expected to match CUDA performance.
