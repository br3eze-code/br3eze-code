#!/usr/bin/env python3
"""Build a sanitized, provenance-aware RouterOS corpus and validate reviewed cases.

Uses only the Python standard library. It never executes repository files and never
turns unlabelled documents into diagnostic training labels.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

TEXT_EXTENSIONS = {".md", ".txt", ".rst", ".html", ".htm", ".yaml", ".yml", ".json", ".rsc", ".cfg", ".conf"}
SKIP_DIRS = {".git", "node_modules", "vendor", "dist", "build", ".venv", "venv", "__pycache__", ".next"}
SECRET_PATTERNS = [
    re.compile(r'(?i)(\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\b\s*[:=]\s*)(["\']?)[^\s,"\'<>]+'),
    re.compile(r'(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+'),
    re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b'),
]
CASE_REQUIRED = {"schemaVersion", "caseId", "domain", "platform", "task", "input", "target", "verification", "reviewStatus", "split"}


def redact(text: str) -> str:
    text = SECRET_PATTERNS[0].sub(r"\1[REDACTED]", text)
    text = SECRET_PATTERNS[1].sub(r"\1[REDACTED]", text)
    return SECRET_PATTERNS[2].sub("[IP-REDACTED]", text)


def digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def read_cases(path: Path) -> list[dict]:
    cases = []
    seen_ids = set()
    family_splits: dict[str, set[str]] = {}
    allowed_splits = {"train", "validation", "test"}
    for line_number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip():
            continue
        try:
            case = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path}:{line_number}: invalid JSON: {exc}") from exc
        missing = CASE_REQUIRED - case.keys()
        if missing:
            raise ValueError(f"{path}:{line_number}: missing fields: {', '.join(sorted(missing))}")
        if case["caseId"] in seen_ids:
            raise ValueError(f"{path}:{line_number}: duplicate caseId {case['caseId']}")
        seen_ids.add(case["caseId"])
        if case["domain"] != "networking" or case["platform"] != "mikrotik-routeros":
            raise ValueError(f"{path}:{line_number}: unexpected domain/platform")
        if case["task"] != "root-cause-diagnosis":
            raise ValueError(f"{path}:{line_number}: unsupported task")
        if case["split"] not in allowed_splits:
            raise ValueError(f"{path}:{line_number}: split must be train, validation, or test")
        if case["reviewStatus"] != "approved":
            raise ValueError(f"{path}:{line_number}: only human/lab-approved cases can enter training data")
        if not isinstance(case["input"], dict) or not isinstance(case["target"], dict):
            raise ValueError(f"{path}:{line_number}: input and target must be objects")
        family = case.get("faultFamily") or case["target"].get("rootCause")
        if not family:
            raise ValueError(f"{path}:{line_number}: faultFamily or target.rootCause is required")
        family_splits.setdefault(str(family), set()).add(case["split"])
        cases.append(case)
    leaked = {family: sorted(splits) for family, splits in family_splits.items() if len(splits) > 1}
    if leaked:
        raise ValueError("fault-family leakage across splits: " + json.dumps(leaked, sort_keys=True))
    if not cases:
        raise ValueError("no approved diagnostic cases found")
    return cases


def build_corpus(root: Path) -> list[dict]:
    records, seen_hashes = [], set()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        relative = path.relative_to(root)
        if any(part in SKIP_DIRS for part in relative.parts):
            continue
        if path.name.lower() in {".env", "id_rsa", "id_ed25519"} or "secret" in path.name.lower():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        cleaned = redact(raw).strip()
        if len(cleaned) < 80:
            continue
        content_hash = digest(cleaned)
        if content_hash in seen_hashes:
            continue
        seen_hashes.add(content_hash)
        records.append({
            "schemaVersion": "1.0",
            "documentId": content_hash[:16],
            "sourcePath": relative.as_posix(),
            "contentSha256": content_hash,
            "licenseStatus": "REVIEW_REQUIRED",
            "content": cleaned,
        })
    return records


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus-root", type=Path, required=True, help="Repository/docs directory to scan")
    parser.add_argument("--cases", type=Path, required=True, help="JSONL of reviewed, labelled diagnostic cases")
    parser.add_argument("--output-dir", type=Path, required=True, help="Output directory (created if needed)")
    args = parser.parse_args()
    try:
        cases = read_cases(args.cases)
        corpus = build_corpus(args.corpus_root)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        write_jsonl(args.output_dir / "corpus.jsonl", corpus)
        for split in ("train", "validation", "test"):
            write_jsonl(args.output_dir / "cases" / f"{split}.jsonl", [case for case in cases if case["split"] == split])
        manifest = {
            "schemaVersion": "1.0",
            "corpusDocuments": len(corpus),
            "approvedCases": len(cases),
            "caseCountsBySplit": {split: sum(case["split"] == split for case in cases) for split in ("train", "validation", "test")},
            "corpusSha256": digest("\n".join(record["contentSha256"] for record in corpus)),
            "casesSha256": digest("\n".join(json.dumps(case, sort_keys=True) for case in cases)),
            "licenseReviewRequired": True,
            "limitations": [
                "Corpus documents are retrieval candidates, not automatically supervised labels.",
                "All corpus records require source/license review before redistribution or training.",
                "IP redaction is conservative and may remove documentation examples; manually review sanitized output.",
                "Split leakage is checked by faultFamily/rootCause, but benchmark quality still depends on independent incident design."
            ],
        }
        (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(manifest, indent=2))
        return 0
    except (OSError, ValueError) as exc:
        print(f"dataset preparation failed: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
