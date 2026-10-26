#!/usr/bin/env python3
"""LoRA supervised fine-tuning for reviewed RouterOS diagnosis JSONL cases.

Launch with torchrun on an 8-GPU Lightning.ai Studio. This is a training scaffold,
not a claim of diagnostic quality; held-out task metrics are a separate gate.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import torch
from peft import LoraConfig, TaskType, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForSeq2Seq,
    Trainer,
    TrainingArguments,
)


def load_cases(path: Path) -> list[dict]:
    rows = []
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        case = json.loads(raw)
        if case.get("reviewStatus") != "approved":
            raise ValueError(f"{path}:{line_number}: refusing unapproved case")
        if case.get("task") != "root-cause-diagnosis":
            raise ValueError(f"{path}:{line_number}: unsupported task")
        if not isinstance(case.get("input"), dict) or not isinstance(case.get("target"), dict):
            raise ValueError(f"{path}:{line_number}: input and target must be objects")
        rows.append(case)
    if not rows:
        raise ValueError(f"{path}: no approved cases")
    return rows


def render_prompt(case: dict) -> str:
    return (
        "You are a cautious MikroTik RouterOS networking diagnostic assistant. "
        "Use only the supplied evidence. Cite evidence identifiers where available. "
        "If evidence is insufficient or conflicting, say so and request a safe next test. "
        "Never propose executing configuration changes. Return a concise JSON diagnosis.\n"
        f"Incident: {json.dumps(case['input'], ensure_ascii=False, sort_keys=True)}\n"
        "Diagnosis JSON:"
    )


def render_target(case: dict) -> str:
    target = {
        "rootCause": case["target"].get("rootCause", "insufficient-evidence"),
        "supportingEvidence": case["target"].get("supportingEvidence", []),
        "nextTest": case["target"].get("nextTest", "Collect more read-only evidence"),
        "confidence": case["target"].get("confidence", "unknown"),
    }
    return " " + json.dumps(target, ensure_ascii=False, sort_keys=True) + "\n"


class DiagnosisDataset(torch.utils.data.Dataset):
    def __init__(self, cases: list[dict], tokenizer, max_length: int):
        self.items = []
        for case in cases:
            prompt = tokenizer(render_prompt(case), add_special_tokens=True)["input_ids"]
            answer = tokenizer(render_target(case), add_special_tokens=False)["input_ids"]
            input_ids = (prompt + answer)[:max_length]
            labels = ([-100] * len(prompt) + answer)[:max_length]
            if len(input_ids) < 2 or not any(label != -100 for label in labels):
                raise ValueError(f"case {case['caseId']} has no trainable target tokens after truncation")
            self.items.append({"input_ids": input_ids, "attention_mask": [1] * len(input_ids), "labels": labels})

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        return self.items[index]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--model", default=os.environ.get("BR3EZE_BASE_MODEL", ""))
    parser.add_argument("--output-dir", type=Path, default=Path("artifacts/routeros-lora"))
    parser.add_argument("--max-length", type=int, default=2048)
    parser.add_argument("--max-time-seconds", type=int, default=604800, help="Default wall-clock cap: one week")
    args = parser.parse_args()
    if not args.model:
        parser.error("set --model or BR3EZE_BASE_MODEL to an open-weight model ID/path whose license you have reviewed")
    if args.max_length < 128:
        parser.error("--max-length must be at least 128")
    if args.max_time_seconds < 60:
        parser.error("--max-time-seconds must be at least 60")

    train_cases, val_cases = load_cases(args.train), load_cases(args.validation)
    train_ids = {case["caseId"] for case in train_cases}
    val_ids = {case["caseId"] for case in val_cases}
    if train_ids & val_ids:
        raise ValueError("caseId leakage between train and validation")
    train_families = {case.get("faultFamily", case["target"].get("rootCause")) for case in train_cases}
    val_families = {case.get("faultFamily", case["target"].get("rootCause")) for case in val_cases}
    if train_families & val_families:
        raise ValueError("fault-family leakage between train and validation")

    tokenizer = AutoTokenizer.from_pretrained(args.model, use_fast=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        low_cpu_mem_usage=True,
    )
    model.config.use_cache = False
    model.gradient_checkpointing_enable()
    target_modules = [item.strip() for item in os.environ.get("BR3EZE_LORA_TARGET_MODULES", "q_proj,v_proj").split(",") if item.strip()]
    lora = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=int(os.environ.get("BR3EZE_LORA_R", "16")),
        lora_alpha=int(os.environ.get("BR3EZE_LORA_ALPHA", "32")),
        lora_dropout=float(os.environ.get("BR3EZE_LORA_DROPOUT", "0.05")),
        target_modules=target_modules,
        bias="none",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    train_data = DiagnosisDataset(train_cases, tokenizer, args.max_length)
    val_data = DiagnosisDataset(val_cases, tokenizer, args.max_length)
    per_device_batch = int(os.environ.get("BR3EZE_BATCH_PER_GPU", "2"))
    grad_accum = int(os.environ.get("BR3EZE_GRAD_ACCUM", "8"))
    if per_device_batch < 1 or grad_accum < 1:
        raise ValueError("BR3EZE_BATCH_PER_GPU and BR3EZE_GRAD_ACCUM must be positive")

    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=float(os.environ.get("BR3EZE_EPOCHS", "3")),
        max_time=float(args.max_time_seconds),
        per_device_train_batch_size=per_device_batch,
        per_device_eval_batch_size=per_device_batch,
        gradient_accumulation_steps=grad_accum,
        learning_rate=float(os.environ.get("BR3EZE_LEARNING_RATE", "0.0002")),
        weight_decay=0.01,
        warmup_ratio=0.03,
        lr_scheduler_type="cosine",
        bf16=torch.cuda.is_available(),
        gradient_checkpointing=True,
        max_grad_norm=1.0,
        logging_steps=10,
        eval_strategy="steps",
        eval_steps=100,
        save_strategy="steps",
        save_steps=100,
        save_total_limit=3,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        report_to="none",
        ddp_find_unused_parameters=False,
        seed=20261026,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_data,
        eval_dataset=val_data,
        data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer, padding=True, label_pad_token_id=-100, return_tensors="pt"),
    )
    trainer.train()
    trainer.save_model(str(args.output_dir / "best-adapter"))
    tokenizer.save_pretrained(str(args.output_dir / "best-adapter"))
    metrics = trainer.evaluate()
    if trainer.is_world_process_zero():
        args.output_dir.mkdir(parents=True, exist_ok=True)
        (args.output_dir / "final-eval-metrics.json").write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
