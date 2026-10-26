# Node.js microGPT foundation

This is an educational native-JavaScript training path inspired by the readable algorithmic approach used in micrograd, microgpt, nanoGPT, and llm.c. The implementation is independently authored; it does not copy their source files.

## Current slice

- `src/llm/autograd.js`: scalar reverse-mode automatic differentiation with add, subtract, multiply, divide, power, ReLU, tanh, exp, log, sum, and softmax.
- `tests/unit/autograd.test.js`: checks the chain rule, gradient accumulation, softmax behavior, invalid operations, and the zero-power derivative edge case.

This is a prerequisite, not yet a GPT model. Do not describe the scalar engine alone as an LLM.

## Intended sequence

1. **Autograd reference:** validate gradients on small, hand-checkable expressions.
2. **Tiny character-level GPT:** add character vocabulary, token and position embeddings, causal self-attention, feed-forward block, cross-entropy loss, and next-character sampling.
3. **Training workflow:** deterministic seeds, configurable context length and steps, loss reporting, checkpoints, and a small synthetic/text fixture.
4. **Correctness gates:** finite-difference gradient checks, loss-decrease smoke tests, checkpoint round trips, and held-out evaluation.
5. **Performance boundary:** keep the reference implementation readable; profile before adding an optional tensor/native/GPU backend.

## Design boundaries

- This is a learning-scale model, not a competitor to hosted LLMs and not an efficient way to train a large GPT model in ordinary Node.js.
- Keep training implementation under `src/llm/`; it must not become a second AgentRuntime.
- AgentOS may expose training and inference through explicit tools or adapters. Model output must never bypass tool permissions or verification.
- Training data and checkpoints should be supplied or generated locally and ignored by Git unless reviewed for privacy, licensing, and size.
- Use independently authored code and document concepts and references; do not copy long source passages from reference repositories.

## References

- https://github.com/karpathy/micrograd
- https://github.com/karpathy/microgpt
- https://github.com/karpathy/nanoGPT
- https://github.com/karpathy/llm.c
