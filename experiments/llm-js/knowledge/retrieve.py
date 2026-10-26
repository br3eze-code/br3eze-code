#!/usr/bin/env python3
"""Small dependency-free lexical retriever for reviewed AgentOS knowledge chunks.

This is a transparent baseline, not a vector database or semantic embedding model.
Only explicitly approved content is searchable by default.
"""
from __future__ import annotations
import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

TOKEN_RE = re.compile(r"[a-z0-9_./:+-]+", re.I)

def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text) if len(token) > 1]

def approved(chunk: dict[str, Any]) -> bool:
    source = chunk.get("source") or {}
    quality = chunk.get("quality") or {}
    return (
        source.get("licenseStatus") == "APPROVED"
        and quality.get("reviewStatus") == "approved"
        and quality.get("privacyStatus") == "approved"
    )

def tenant_allowed(chunk: dict[str, Any], tenant_id: str | None) -> bool:
    owner = chunk.get("tenantId")
    # Tenant-scoped records are never visible to an unscoped/global query.
    if owner is not None:
        return tenant_id is not None and owner == tenant_id
    # Global records may be used by tenant-scoped queries.
    return True

def search(chunks: list[dict[str, Any]], query: str, limit: int = 5, tenant_id: str | None = None) -> list[dict[str, Any]]:
    terms = tokenize(query)
    if not terms or limit < 1:
        return []
    corpus = []
    for chunk in chunks:
        if not approved(chunk) or not tenant_allowed(chunk, tenant_id):
            continue
        tokens = tokenize(str(chunk.get("text", "")))
        if tokens:
            corpus.append((chunk, tokens, Counter(tokens)))
    if not corpus:
        return []
    n = len(corpus)
    avg_len = sum(len(tokens) for _, tokens, _ in corpus) / n
    doc_freq = {term: sum(1 for _, tokens, _ in corpus if term in set(tokens)) for term in set(terms)}
    scored = []
    for chunk, tokens, frequencies in corpus:
        score = 0.0
        length = len(tokens)
        for term in terms:
            tf = frequencies[term]
            if not tf:
                continue
            idf = math.log(1 + (n - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5))
            k1, b = 1.2, 0.75
            score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * length / max(avg_len, 1)))
        if score > 0:
            scored.append((score, chunk))
    scored.sort(key=lambda item: (-item[0], str(item[1].get("chunkId", ""))))
    results = []
    for score, chunk in scored[:limit]:
        results.append({
            "score": round(score, 6),
            "chunkId": chunk.get("chunkId"),
            "documentId": chunk.get("documentId"),
            "source": chunk.get("source", {}),
            "span": chunk.get("span", {}),
            "text": chunk.get("text", ""),
        })
    return results

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunks", required=True, help="JSONL output from chunk_documents.py")
    parser.add_argument("--query", required=True)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--tenant-id", help="search global content plus this tenant's private content")
    args = parser.parse_args(argv)
    if args.limit < 1:
        parser.error("--limit must be positive")
    try:
        chunks = []
        with Path(args.chunks).open(encoding="utf-8") as stream:
            for line_no, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise ValueError(f"line {line_no}: record must be an object")
                chunks.append(item)
        print(json.dumps({"query": args.query, "results": search(chunks, args.query, args.limit, args.tenant_id)}, ensure_ascii=False, indent=2))
        return 0
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        print(f"retrieval failed: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
