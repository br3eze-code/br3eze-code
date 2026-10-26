# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational language-model work, especially **llm.c** (C/CUDA training systems) and **makemore/nanoGPT**.

This is original educational code—not a line-for-line port of `llm.c` and not a competitive general-purpose LLM. It includes a character-level bigram baseline and a tiny trainable decoder-only character model to make the forward/backward/update loop inspectable.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train the bigram baseline

```bash
node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42
```

## Train TinyGPT with multi-head attention and AdamW

```bash
node experiments/llm-js/train-gpt.js --steps 100 --context 16 --width 8 --heads 2 --hidden 32 --lr 0.01 --seed 42
```

Use `--input path/to/text.txt` to train on a UTF-8 text file you have permission to use. The trainer reports loss before and after training on the same fixed window, generates a sample, and saves a JSON model checkpoint. Change the destination with `--checkpoint path/to/model.json`. Do not commit private training data or checkpoints.

Options include `--steps`, `--context`, `--width`, `--heads`, `--hidden`, `--lr`, `--seed`, `--generate`, `--input`, and `--checkpoint`. The number of heads must divide the embedding width. Keep dimensions small for CPU training.

## Test

```bash
node --test experiments/llm-js/*.test.js
```

## Implemented

- Character vocabulary and bigram baseline with stable softmax, cross-entropy, analytic gradients, SGD and JSON checkpointing.
- `Tensor`: Float64 scalar/vector/matrix operations, matrix multiplication, transpose, row-wise softmax, ReLU, exp/log/sum and reverse-mode automatic differentiation.
- Embedding lookup with scatter-add gradients, differentiable row/column selection and concatenation, stable softmax and cross-entropy.
- Causal multi-head scaled dot-product attention, learned token and position embeddings, linear layers, layer normalization, residual connections and a feed-forward block.
- `TinyGPT`: configurable single- or multi-head decoder-only character model, gradient clipping, AdamW updates, deterministic sampling and model-weight checkpoint round trips.
- Node's built-in tests and a Node 22 GitHub Actions workflow for unit tests and CLI smoke tests.

## Important limits

This is a correctness-first CPU learning implementation, not a production LLM. It supports one decoder block and character-level tokens. It does not yet provide BPE/tokenizer training, stacked blocks, dropout, robust mini-batch training, a proper held-out validation pipeline, optimizer-state checkpoint/resume, gradient accumulation, efficient tensor kernels, GPU acceleration or distributed training. Checkpoints currently preserve model weights and architecture, not AdamW's moment state. The pure-JavaScript Float64 tensor engine will be much slower than optimized C/CUDA backends, and a tiny corpus will not teach broad language competence.

## Roadmap

1. **Implemented:** bigram baseline, tensor/autograd, decoder block, multi-head causal attention, AdamW, sampling and model-weight checkpoints.
2. **Training reliability:** finite-difference gradient checks, fixed train/validation split, mini-batches, optimizer-state checkpoint/resume and better failure diagnostics.
3. **Model depth and data:** configurable stacked blocks, dropout, tokenizer interface/BPE, and repeatable evaluation metrics.
4. **Performance:** benchmark first, then consider optimized typed-array kernels, WebGPU or a native backend.
5. **AgentOS integration:** only after model and tokenizer interfaces are stable; keep training isolated from the domain-agnostic runtime.

## Relationship to Karpathy's work

- `llm.c` is a low-level C/CUDA training and performance-engineering reference.
- `makemore` and `nanoGPT` are useful educational references for language-model structure and training loops.
- This directory translates learning goals into original JavaScript code; it does not copy their source. Node.js should not be expected to match CUDA performance.
