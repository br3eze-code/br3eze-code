# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational work, especially **micrograd**, **makemore/nanoGPT**, and **llm.c**. This is an original JavaScript translation of the learning patterns, not a line-for-line copy of upstream source.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train models

Bigram baseline: `node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42`

TinyGPT (one decoder block): `node experiments/llm-js/train-gpt.js --steps 100 --context 16 --width 8 --heads 2 --hidden 32 --lr 0.01 --seed 42`

Configurable stacked Transformer: `node experiments/llm-js/train-transformer.js --steps 200 --context 16 --width 8 --heads 2 --layers 2 --hidden 32 --seed 42`

Use `--input path/to/text.txt` for a UTF-8 corpus you have permission to use. The Transformer CLI holds out a final segment for a small validation-loss check and writes a JSON checkpoint. Resume with `--resume path/to/checkpoint.json`; the input text and character vocabulary must match. Select output using `--checkpoint path/to/model.json`. Keep dimensions small: this is a CPU reference implementation, not a fast or production-scale LLM.

## Tests

`node --test experiments/llm-js/*.test.js`

## Implemented

- Character-level bigram baseline, stable softmax/cross-entropy, analytic gradients and SGD.
- `Tensor`: Float64 scalar/vector/matrix operations and reverse-mode automatic differentiation.
- Token and position embeddings, causal attention, linear layers, layer normalization, residual paths and MLP blocks.
- `TinyGPT`: a compact single-block educational model with configurable attention heads and AdamW updates.
- `TransformerLM`: configurable width, number of causal attention heads, stacked decoder blocks and MLP width; gradient clipping; deterministic sampling; model plus optimizer-state checkpoint serialization.
- CLI training, fixed-seed runs, basic held-out validation, checkpoint save and resume.

## Limits and roadmap

This is a correctness-first learning system. It uses character-level tokens, hand-written Float64 autodiff and single-sequence updates. It does not yet provide BPE, dropout, true multi-sequence minibatching, exhaustive validation, finite-difference gradient checks, optimized kernels, GPU acceleration or distributed training. It will be much slower than C/CUDA, and the demo corpus cannot teach broad language competence.

Next: gradient checks, rigorous dataset splits, batching, optimizer/weight-decay audit, profiling, and only then an AgentOS adapter. Keep training isolated from the domain-agnostic agent runtime until the API and tests are stable.

## Relationship to Karpathy's work

`llm.c` is a C/CUDA performance-engineering reference; `micrograd`, `makemore`, and `nanoGPT` offer educational patterns for autodiff and language-model training. This implementation translates those ideas into original JavaScript rather than copying source or promising CUDA-level performance.
