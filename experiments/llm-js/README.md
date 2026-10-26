# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational language-model work, especially **llm.c** (C/CUDA training systems) and **makemore/nanoGPT**.

This is an original educational implementation—not a line-for-line port of `llm.c` and not a competitive general-purpose LLM. It starts with a character-level bigram baseline, then introduces the primitives needed to build a small neural language model.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train the bigram baseline

```bash
node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42
```

Supply a UTF-8 text file you have permission to use with `--input path/to/text.txt`. The trainer prints loss and a generated sample, then writes a JSON checkpoint. Change the destination with `--checkpoint path/to/model.json`; avoid committing private training data or generated checkpoints.

## Test

```bash
node --test experiments/llm-js/*.test.js
```

## Implemented

- Character vocabulary, next-character pairs, deterministic initialization and sampling.
- Bigram model with stable softmax, cross-entropy, analytic gradients, SGD, and JSON checkpointing.
- `Tensor`: Float64 scalar/vector/matrix values, elementwise operations, matrix multiplication, ReLU, exp/log/sum, and reverse-mode automatic differentiation.
- Language-model operations: embedding lookup with scatter-add gradients, stable vector softmax, and stable single-example cross-entropy.
- Node's built-in test runner; no external dependencies.

## Current boundaries

The tensor engine is deliberately correctness-first and CPU-only. It supports scalars, vectors and rank-2 matrices, with scalar broadcasting only. It is not optimized for speed and is not yet a complete Transformer implementation. There is no causal self-attention, positional encoding, layer normalization, AdamW, BPE tokenizer, batching pipeline, GPU kernel, or distributed training.

## Roadmap

1. **Foundations (current):** bigram baseline, tensor/autograd, embedding, softmax and cross-entropy.
2. **Transformer blocks:** tensor shape utilities, causal masked self-attention, positional information, feed-forward blocks and residual connections.
3. **Training loop:** AdamW, minibatches, train/validation split, gradient checks, checkpoint resume and deterministic evaluation.
4. **Performance:** benchmark first; then consider optimized typed-array kernels, WebGPU or a native backend.
5. **AgentOS integration:** only after model interfaces and tests are stable; keep model training isolated from the domain-agnostic runtime.

## Relationship to Karpathy's work

- `llm.c` is a low-level C/CUDA training implementation and performance-engineering reference.
- `makemore` and `nanoGPT` are useful educational references for language-model structure and training loops.
- This directory contains original JavaScript code that translates learning goals and concepts, not copied source. A Node.js implementation should not be expected to match CUDA performance.
