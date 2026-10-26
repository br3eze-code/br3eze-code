#!/usr/bin/env python3
"""Optional pretrained-model LoRA backend, launched by the Node.js CLI."""
import argparse
import json
import os
from pathlib import Path

import torch
from peft import LoraConfig, TaskType, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=4)
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--lr", type=float, default=2e-4)
    return parser.parse_args()


def load_records(path):
    records = []
    for line_number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        if isinstance(row.get("messages"), list):
            messages = row["messages"]
            rendered = None
        elif isinstance(row.get("prompt"), str) and isinstance(row.get("completion"), str):
            messages = [
                {"role": "user", "content": row["prompt"]},
                {"role": "assistant", "content": row["completion"]},
            ]
            rendered = None
        elif isinstance(row.get("text"), str):
            messages = None
            rendered = row["text"]
        else:
            raise ValueError(f"Unsupported record on line {line_number}")
        if messages is not None:
            if not messages or any(not isinstance(m, dict) or not isinstance(m.get("role"), str)
                                   or not isinstance(m.get("content"), str) for m in messages):
                raise ValueError(f"Invalid messages format on line {line_number}")
            records.append({"messages": messages})
        else:
            records.append({"text": rendered})
    if len(records) < 2:
        raise ValueError("At least two dataset records are required")
    return records


class TokenizedDataset(torch.utils.data.Dataset):
    def __init__(self, records, tokenizer, max_length):
        self.items = []
        for row in records:
            is_chat = "messages" in row
            if is_chat:
                if not getattr(tokenizer, "chat_template", None):
                    raise ValueError(
                        "This model tokenizer has no chat template. Use {text: ...} records "
                        "or a model with a chat template."
                    )
                text = tokenizer.apply_chat_template(
                    row["messages"], tokenize=False, add_generation_prompt=False
                )
            else:
                text = row["text"]
            # Chat templates already insert their special tokens; avoid adding them twice.
            encoded = tokenizer(
                text,
                truncation=True,
                max_length=max_length,
                add_special_tokens=not is_chat,
            )
            if len(encoded["input_ids"]) >= 2:
                self.items.append({key: torch.tensor(value, dtype=torch.long) for key, value in encoded.items()})
        if not self.items:
            raise ValueError("Each train/validation split must contain at least one record that tokenizes to 2+ tokens")

    def __len__(self):
        return len(self.items)

    def __getitem__(self, index):
        return self.items[index]


def main():
    args = parse_args()
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    torch.manual_seed(42)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    records = load_records(args.input)
    split = max(1, min(len(records) - 1, int(len(records) * 0.9)))
    train_records, eval_records = records[:split], records[split:]

    tokenizer = AutoTokenizer.from_pretrained(args.model, use_fast=True)
    if tokenizer.pad_token_id is None:
        if tokenizer.eos_token_id is None:
            raise ValueError("Tokenizer has neither a pad token nor an EOS token")
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(args.model)
    model.config.use_cache = False

    # Common attention projections across Llama/Mistral/Qwen-style architectures.
    target_modules = ["q_proj", "k_proj", "v_proj", "o_proj"]
    module_names = {name.rsplit(".", 1)[-1] for name, _ in model.named_modules()}
    matched = [name for name in target_modules if name in module_names]
    if not matched:
        raise ValueError(
            "Could not find common q_proj/k_proj/v_proj/o_proj modules. "
            "This starter currently targets Llama/Mistral/Qwen-style models."
        )
    peft_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.rank,
        lora_alpha=args.rank * 2,
        lora_dropout=0.05,
        target_modules=matched,
        bias="none",
    )
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()

    train_dataset = TokenizedDataset(train_records, tokenizer, args.max_length)
    eval_dataset = TokenizedDataset(eval_records, tokenizer, args.max_length)
    training_args = TrainingArguments(
        output_dir=str(output / "trainer-state"),
        max_steps=args.steps,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.03,
        weight_decay=0.01,
        logging_steps=max(1, min(10, args.steps // 10)),
        eval_strategy="steps",
        eval_steps=max(1, min(50, args.steps // 5)),
        save_strategy="no",
        report_to="none",
        fp16=torch.cuda.is_available(),
        bf16=False,
        remove_unused_columns=False,
        seed=42,
    )
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
    )
    trainer.train()
    metrics = trainer.evaluate()
    model.save_pretrained(output)
    tokenizer.save_pretrained(output)
    (output / "br3eze-finetune.json").write_text(
        json.dumps({
            "base_model": args.model,
            "method": "LoRA",
            "train_records": len(train_dataset),
            "validation_records": len(eval_dataset),
            "steps": args.steps,
            "rank": args.rank,
            "target_modules": matched,
            "evaluation": metrics,
        }, indent=2),
        encoding="utf-8",
    )
    print(f"Saved LoRA adapter and tokenizer to {output}")
    print("Keep the original base model available; this directory contains adapter weights, not a full model.")


if __name__ == "__main__":
    main()
