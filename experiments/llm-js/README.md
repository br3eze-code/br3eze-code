# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational language-model work, especially **llm.c** (C/CUDA training systems) and **makemore/nanoGPT**.

This is original educational code—not a line-for-line port of `llm.c` and not a competitive general-purpose LLM. It starts with a character-level bigram baseline and includes a tiny trainable decoder-only character model so the complete forward/backward/update loop can be explored.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train the bigram baseline

```bash
node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42
```

## Train the tiny decoder-only model

```bash
node experiments/llm-js/train-gpt.js --steps 100 --context 16 --width 8 --hidden 32 --lr 0.01 --seed 42
```

Use `--input path/to/text.txt` to train on a UTF-8 text file you have permission to use. The trainer reports the same evaluation window's loss before and after training, generates a sample, and saves a JSON checkpoint. Change the destination with `--checkpoint path/to/model.json`. Avoid committing private training data or checkpoints.

Useful tiny-model options: `--steps`, `--context`, `--width`, `--hidden`, `--lr`, `--seed`, `--generate`, `--input`, and `--checkpoint`. Keep dimensions small for CPU training.

## Test

```bash
node --test experiments/llm-js/*.test.js
```

## Implemented

- Character vocabulary and bigram baseline with stable softmax, cross-entropy, analytic gradients, SGD and JSON checkpointing.
- `Tensor`: Float64 scalar/vector/matrix operations, matrix multiplication, transpose, row-wise softmax, ReLU, exp/log/sum and reverse-mode automatic differentiation.
- Embedding lookup with scatter-add gradients, differentiable row selection, stable vector softmax and cross-entropy.
- Causal single-head scaled dot-product attention, learned token and position embeddings, linear layers, layer normalization, residual connections and a feed-forward block.
- `TinyGPT`: a small decoder-only character model with clipped-SGD updates, deterministic sampling and JSON checkpoint round trips.
- Node's built-in tests and a Node 22 GitHub Actions workflow for unit tests and CLI smoke tests.

## Important limits

This is a correctness-first CPU learning implementation, not a production LLM. It uses one attention head, character-level tokens, small context windows and plain SGD. It does not yet include multi-head attention, AdamW, batching across multiple sequences, validation-data management, BPE, optimized tensor kernels, GPU acceleration, or distributed training. It will be much slower than C/CUDA implementations and cannot learn broad language competence from the tiny built-in corpus.

## Roadmap

1. **Implemented:** bigram baseline, tensor/autograd, TinyGPT forward/backward, causal attention, training CLI, checkpoint serialization.
2. **Training quality:** AdamW, gradient-check comparisons against finite differences, mini-batches, train/validation split, and checkpoint-resume in the CLI.
3. **Model quality:** multi-head attention, dropout, configurable depth, more robust tokenizer options and evaluation metrics.
4. **Performance:** profile first, then consider optimized typed-array kernels, WebGPU or a native backend.
5. **AgentOS integration:** only after the model API and tests are stable; keep training isolated from the domain-agnostic runtime.

## Relationship to Karpathy's work

- `llm.c` is a low-level C/CUDA training and performance-engineering reference.
- `makemore` and `nanoGPT` are useful educational references for language-model structure and training loops.
- This directory translates learning goals into original JavaScript code; it does not copy their source. Node.js should not be expected to match CUDA performance.
