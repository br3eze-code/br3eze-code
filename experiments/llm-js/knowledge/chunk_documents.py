#!/usr/bin/env python3
"""Deterministically chunk normalized AgentOS knowledge JSONL documents."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any, Iterable

def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def split_text(text: str, max_chars: int, overlap: int) -> Iterable[tuple[int, int, str]]:
    """Yield (start, end, text) chunks, preferring paragraph/line boundaries."""
    if max_chars < 1 or overlap < 0 or overlap >= max_chars:
        raise ValueError("require max_chars > 0 and 0 <= overlap < max_chars")
    start = 0
    length = len(text)
    while start < length:
        hard_end = min(start + max_chars, length)
        end = hard_end
        if hard_end < length:
            floor = start + max(1, max_chars // 2)
            candidates = [text.rfind("\n\n", floor, hard_end), text.rfind("\n", floor, hard_end), text.rfind(" ", floor, hard_end)]
            boundary = max(candidates)
            if boundary > start:
                end = boundary
        piece = text[start:end].strip()
        if piece:
            # Offsets point to the original normalized text, including trimmed edge whitespace.
            left = start
            while left < end and text[left].isspace():
                left += 1
            right = end
            while right > left and text[right - 1].isspace():
                right -= 1
            yield left, right, text[left:right]
        if end >= length:
            break
        next_start = max(start + 1, end - overlap)
        # Avoid producing a chunk consisting only of overlap.
        start = next_start

def chunk_document(document: dict[str, Any], max_chars: int = 1600, overlap: int = 160) -> list[dict[str, Any]]:
    text = document.get("content", {}).get("text")
    document_id = document.get("documentId")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("document content.text must be a non-empty string")
    if not isinstance(document_id, str) or not document_id:
        raise ValueError("document documentId must be a non-empty string")
    chunks = []
    for index, (start, end, chunk_text) in enumerate(split_text(text, max_chars, overlap)):
        chunk_id = digest(f"{document_id}:{start}:{end}:{digest(chunk_text)}")[:32]
        chunks.append({
            "schemaVersion": "1.0",
            "chunkId": chunk_id,
            "documentId": document_id,
            "chunkIndex": index,
            "span": {"startChar": start, "endChar": end},
            "source": document.get("source", {}),
            "quality": document.get("quality", {}),
            "tenantId": document.get("tenantId"),
            "text": chunk_text,
            "contentHash": "sha256:" + digest(chunk_text),
        })
    return chunks

def read_jsonl(path: Path):
    with path.open(encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise ValueError("record must be a JSON object")
                yield line_no, item
            except (json.JSONDecodeError, ValueError) as exc:
                raise ValueError(f"{path}:{line_no}: invalid document: {exc}") from exc

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="documents.jsonl from ingest.py")
    parser.add_argument("--output", required=True, help="output chunks JSONL")
    parser.add_argument("--max-chars", type=int, default=1600)
    parser.add_argument("--overlap", type=int, default=160)
    args = parser.parse_args(argv)
    if args.max_chars < 1 or args.overlap < 0 or args.overlap >= args.max_chars:
        parser.error("require --max-chars > 0 and 0 <= --overlap < --max-chars")
    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    if source == output:
        parser.error("input and output must be different files")
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        total_docs = total_chunks = 0
        with output.open("w", encoding="utf-8", newline="\n") as stream:
            for _, document in read_jsonl(source):
                chunks = chunk_document(document, args.max_chars, args.overlap)
                total_docs += 1
                total_chunks += len(chunks)
                for chunk in chunks:
                    stream.write(json.dumps(chunk, ensure_ascii=False, sort_keys=True) + "\n")
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"chunking failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"documentsRead": total_docs, "chunksWritten": total_chunks, "output": str(output)}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
