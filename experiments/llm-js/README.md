# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational language-model work, especially **llm.c** (C/CUDA training systems) and **makemore/nanoGPT** (small models that make the training loop understandable).

This is an original, deliberately small first milestone—not a line-for-line port of `llm.c`, and not a competitive general-purpose LLM. It trains a character-level **bigram baseline** so the tokenizer, next-token objective, gradients, optimizer, sampling, and checkpoint lifecycle can be tested before implementing a decoder-only Transformer.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train

```bash
node experiments/llm-js/train.js --input experiments/llm-js/data/tiny.txt --steps 2000 --lr 0.1 --seed 42
```

If `--input` is omitted, the script uses a tiny built-in sample. For useful learning, supply a UTF-8 text file you have permission to use.

## Generate

```bash
node experiments/llm-js/train.js --input experiments/llm-js/data/tiny.txt --steps 2000 --generate 300
```

The trainer prints initial/final loss and samples generated text. It writes a JSON checkpoint to `experiments/llm-js/checkpoint.json` unless `--checkpoint <path>` is supplied. Do not commit large or private training data/checkpoints.

## What is implemented

- Deterministic character vocabulary and encode/decode.
- Trainable next-character conditional probability table.
- Stable softmax and cross-entropy loss.
- Analytic gradients for each training example and SGD updates.
- Seeded initialization/sampling for reproducible smoke tests.
- JSON checkpoint save/load.
- Input validation and a dependency-free test suite.

## Limitations

This is a **baseline**, not yet a Transformer: no multi-head self-attention, positional embeddings, MLP blocks, backpropagation through a deep network, BPE tokenizer, distributed training, mixed precision, or GPU kernels. Character-level bigrams only learn one-character context. The next milestones are a tensor/autograd layer, decoder-only Transformer, AdamW, batching, validation split, checkpoint-resume, and optional accelerated backends.

## Design relationship

- `llm.c` demonstrates low-level training implementation and performance engineering in C/CUDA.
- This folder expresses the educational training concepts in JavaScript/Node.js and keeps them isolated from AgentOS runtime contracts.
- The implementation is original code; it does not copy source from `llm.c`.

Run tests with:

```bash
node --test experiments/llm-js/*.test.js
```
