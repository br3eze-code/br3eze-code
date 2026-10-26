# llm-js: a small language-model training lab

A dependency-free Node.js learning implementation inspired by Andrej Karpathy's educational language-model work, especially **micrograd**, **makemore/nanoGPT**, and **llm.c**. This is an original JavaScript translation of the learning ideas, not a line-for-line copy of upstream source.

## Requirements

- Node.js 22+
- No third-party packages or GPU required

## Train models

Bigram baseline: `node experiments/llm-js/train.js --steps 2000 --lr 0.1 --seed 42`

Small single-head educational model: `node experiments/llm-js/train-gpt.js --steps 100 --context 16 --width 8 --hidden 32 --lr 0.01 --seed 42`

Configurable decoder-only Transformer: `node experiments/llm-js/train-transformer.js --steps 200 --context 16 --width 8 --heads 2 --layers 2 --hidden 32 --seed 42`

Pass `--input path/to/text.txt` to use a UTF-8 text corpus you have permission to use. The Transformer CLI holds out a final text segment for a small validation-loss check and writes a JSON checkpoint. Resume with `--resume path/to/checkpoint.json`; the input text and character vocabulary must match. Use `--checkpoint path/to/model.json` to choose the output. Keep model dimensions small: this is a CPU reference implementation, not a fast or production-scale LLM.

## Tests

`node --test experiments/llm-js/*.test.js`

## Implemented

- Character vocabulary, bigram baseline, stable softmax/cross-entropy, analytic gradients and SGD.
- `Tensor`: Float64 scalar/vector/matrix operations and reverse-mode automatic differentiation.
- Token/position embeddings, causal attention, linear layers, layer normalization, residual connections and feed-forward blocks.
- `TinyGPT`: a small single-head educational decoder model.
- `TransformerLM`: configurable width, head count, block depth and MLP width; causal multi-head self-attention; AdamW-style updates with gradient clipping; deterministic generation; model and optimizer checkpoint serialization.
- CLI training with deterministic seeds, a small validation window, checkpoint save and resume.

## Limits and roadmap

This is a correctness-first learning system. It uses character-level tokenization, a hand-written Float64 autodiff engine and single-example sequence updates. It does not yet have BPE, dropout, true multi-sequence minibatching, robust train/validation evaluation, gradient-check tests, optimized kernels, GPU acceleration, or distributed training. It cannot be expected to develop broad language competence from the built-in demo corpus, and it will be much slower than C/CUDA implementations.

Next: numerical gradient checks, more rigorous dataset splitting/evaluation, batching, optimizer/weight-decay audit, profiling, and only then an AgentOS adapter. Keep this trainer isolated from the domain-agnostic agent runtime until the API and tests are stable.
