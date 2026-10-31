# Lightning.ai GPU training

## Strategy

Use a reviewed open-weight causal language model and supervised LoRA fine-tuning for diagnostic behavior. Keep the existing Node.js TinyGPT lab as an educational experiment; do not expect it to become a broadly capable network engineer from a week of compute. The training code is a separate Python experiment adapter and does not create a second AgentRuntime.

The default target is one week of wall-clock training, capped at 604,800 seconds. Do **not** launch the full run until the corpus and held-out incident benchmark are large enough. With only the five initial simulator scenarios, training would overfit and produce misleading metrics.

## Studio setup

1. Create a Lightning.ai Studio with 8 H100 GPUs and persistent storage sufficient for the base model, dataset, checkpoints, and logs.
2. Clone this repository and check out the patch branch/merged commit.
3. Use a clean Python environment and install the requirements:
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   pip install -r experiments/llm-js/networking/ml/requirements-training.txt
   ```
4. Choose a model whose license permits the intended training and deployment. Authenticate only if the model host requires it; never commit tokens. Set `BR3EZE_BASE_MODEL` to its model ID or local path.
5. Prepare reviewed cases. The training input must be the output of the dataset preparation step; it must contain approved cases and distinct fault families between train and validation.
6. First run a short smoke test (small subset, `--max-time-seconds 300`) and confirm all 8 GPUs are visible, loss is finite, a checkpoint saves/restores, and the evaluator improves on held-out families.

## Launch

Run from the repository root with a compatible model architecture exposing `q_proj` and `v_proj` modules by default. Override `BR3EZE_LORA_TARGET_MODULES` for models using different attention-layer names.

```bash
torchrun --standalone --nnodes=1 --nproc_per_node=8 \
  experiments/llm-js/networking/ml/train_sft.py \
  --model "$BR3EZE_BASE_MODEL" \
  --train /data/routeros/cases/train.jsonl \
  --validation /data/routeros/cases/validation.jsonl \
  --output-dir /data/checkpoints/routeros-lora \
  --max-time-seconds 604800
```

`torchrun` + Transformers Trainer uses distributed data parallel across the eight local GPUs; H100 BF16 is enabled when CUDA is available. The run uses LoRA (default rank 16), AdamW, warmup, cosine scheduling, gradient clipping, gradient checkpointing, periodic evaluation and checkpoints. Batch/accumulation, learning rate, epoch count, LoRA rank and target modules can be controlled with the `BR3EZE_*` environment variables documented in the script.

## Promotion gates — required before production use

Validation loss alone is not a diagnosis quality score. Before a candidate can be used by Br3eze AgentOS, evaluate it on a frozen, untouched test set with independent fault-family splits and compare it with the deterministic baseline and retrieval-only baseline. Report top-1/top-3 accuracy, per-class precision/recall, evidence grounding, next-test usefulness, abstention quality, calibration (Brier score or ECE), latency, and regressions on healthy/noisy/conflicting cases. Reject the checkpoint if the model invents evidence, fails to abstain, or regresses on safety tests.

Keep the base model, dataset manifest/hash, code commit, resolved package versions, seed, training args, logs, and checkpoint together. Upload only sanitized, license-reviewed data. The training adapter has no RouterOS client or write tools. Runtime inference may propose diagnoses/tests only; AgentRuntime and its policy layer remain the sole authority for tool execution.
