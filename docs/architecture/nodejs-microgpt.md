# Node.js microGPT foundation

This branch starts a native-JavaScript educational training path inspired by the readable algorithmic approach of Andrej Karpathy's micrograd, microgpt, nanoGPT, and llm.c. It does not copy their source files. The implementation is an independent, small reference engine intended to make the math and training steps inspectable.

## Current slice

- `src/llm/autograd.js`: scalar reverse-mode automatic differentiation with add, subtract, multiply, divide, power, ReLU, tanh, exp, log, sum, and softmax.
- `tests/unit/autograd.test.js`: checks the chain rule, gradient accumulation, softmax behavior, and invalid operations.

This is a prerequisite, not yet a GPT model. Do not describe the scalar engine alone as an LLM.

## Intended sequence

1. **Autograd reference:** validate gradients on small, hand-checkable expressions.
2. **Tiny character-level GPT:** add character vocabulary, token and position embeddings, causal self-attention, feed-forward block, cross-entropy loss, and next-character sampling.
3. **Training workflow:** deterministic seeds, configurable context length and steps, loss reporting, checkpoints, and a small synthetic/text fixture.
4. **Correctness gates:** finite-difference gradient checks, loss-decrease smoke tests, checkpoint round trips, and held-out evaluation.
5. **Performance boundary:** keep the reference implementation readable; profile before adding an optional tensor/native/GPU backend.

## Design boundaries

- This is a learning-scale model, not a competitor to hosted LLMs and not a way to train a large GPT model efficiently in ordinary Node.js.
- Keep the training implementation under `src/llm/`; it must not become a second AgentRuntime.
- AgentOS may later expose training and inference through explicit tools or adapters. Model-generated output must never bypass tool permissions or verification.
- Training data and model checkpoints should be supplied/generated locally and ignored by Git unless explicitly reviewed for privacy, licensing, and size.
- Use independently authored code and document the concepts and references. Do not copy long source passages from reference repositories.

## References

- https://github.com/karpathy/micrograd
- https://github.com/karpathy/microgpt
- https://github.com/karpathy/nanoGPT
- https://github.com/karpathy/llm.c
