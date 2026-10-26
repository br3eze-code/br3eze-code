# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational language-model work, especially **llm.c** (C/CUDA training systems) and **makemore/nanoGPT**.

This is original educational code—not a line-for-line port of `llm.c` and not a competitive general-purpose LLM. It includes a character-level bigram baseline and a tiny trainable decoder-only Transformer so the forward/backward/update loop can be inspected.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train the bigram baseline

```bash
node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42
```

## Train TinyGPT

```bash
node experiments/llm-js/train-gpt.js --steps 100 --context 16 --width 8 --heads 2 --layers 2 --hidden 32 --lr 0.01 --seed 42
```

Use `--input path/to/text.txt` to train on a UTF-8 text file you have permission to use. The CLI makes a simple sequential 90/10 train/validation split, trains only on the training portion, reports held-out validation loss before and after training, generates a sample, and saves model weights, AdamW moments, and the character vocabulary. For a very small corpus the split is necessarily weak; use a larger, representative dataset for meaningful evaluation.

Options include `--steps`, `--context`, `--width`, `--heads`, `--layers`, `--hidden`, `--lr`, `--seed`, `--generate`, `--input`, `--resume`, and `--checkpoint`. The head count must divide the embedding width. Keep dimensions small for CPU training.

## Test

```bash
node --test experiments/llm-js/*.test.js
```

## Implemented

- Character vocabulary and bigram baseline with stable softmax, cross-entropy, analytic gradients, SGD and JSON checkpointing.
- `Tensor`: Float64 scalar/vector/matrix operations, matrix multiplication, transpose, row-wise softmax, ReLU, exp/log/sum and reverse-mode automatic differentiation.
- Embedding lookup, differentiable row/column slicing and concatenation, stable softmax and cross-entropy.
- Causal multi-head scaled dot-product attention, learned token and position embeddings, linear layers, layer normalization, residual connections and feed-forward blocks.
- `TinyGPT`: configurable decoder depth and attention-head count, gradient clipping, AdamW updates, deterministic sampling and model-plus-optimizer checkpoint/resume.
- A simple held-out validation split and saved character vocabulary.
- Node's built-in tests and a Node 22 GitHub Actions workflow for unit tests and CLI smoke tests.

## Important limits

This is a correctness-first CPU learning implementation, not a production LLM. It uses character-level tokens, small context windows, one simple sequential validation split, and a pure-JavaScript Float64 tensor engine. It does not yet provide BPE/tokenizer training, dropout, robust shuffled mini-batches, gradient accumulation, learning-rate schedules, broad benchmark coverage, efficient tensor kernels, GPU acceleration or distributed training. Checkpoints currently preserve model weights, architecture, and AdamW moment state. Resume requires the original corpus; the sampling RNG stream restarts rather than continuing exactly. Performance and model quality will be far below mature native/GPU training stacks, and a tiny corpus will not teach broad language competence.

## Roadmap

1. **Implemented foundation:** tensor/autograd, multi-head causal attention, configurable stacked decoder blocks, AdamW, train/validation separation and model-plus-optimizer checkpoints.
2. **Training reliability:** finite-difference checks for more operations, RNG-state checkpointing, mini-batches, better tokenization, and repeatable validation metrics.
3. **Model quality:** dropout, learning-rate schedules, robust dataset packing, tokenizer interface/BPE, and evaluation on held-out data.
4. **Performance:** benchmark first, then consider optimized typed-array kernels, WebGPU or a native backend.
5. **AgentOS integration:** only after model and tokenizer interfaces are stable; keep training isolated from the domain-agnostic runtime.

## Relationship to Karpathy's work

- `llm.c` is a low-level C/CUDA training and performance-engineering reference.
- `makemore` and `nanoGPT` are useful educational references for language-model structure and training loops.
- This directory translates learning goals into original JavaScript code; it does not copy their source. Node.js should not be expected to match CUDA performance.
