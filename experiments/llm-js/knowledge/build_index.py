#!/usr/bin/env python3
"""Build a local SQLite FTS5 index from approved AgentOS knowledge chunks."""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

def is_approved(item: dict[str, Any]) -> bool:
    source = item.get("source") or {}
    quality = item.get("quality") or {}
    return source.get("licenseStatus") == "APPROVED" and quality.get("reviewStatus") == "approved" and quality.get("privacyStatus") == "approved"

def read_chunks(path: Path):
    with path.open(encoding="utf-8") as stream:
        for line_no, line in enumerate(stream, 1):
            if not line.strip():
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"{path}:{line_no}: invalid JSON: {exc}") from exc
            if not isinstance(item, dict) or not isinstance(item.get("chunkId"), str) or not isinstance(item.get("text"), str):
                raise ValueError(f"{path}:{line_no}: expected chunkId and text fields")
            yield item

def build_index(chunks_path: Path, database_path: Path) -> dict[str, int]:
    if chunks_path.resolve() == database_path.resolve():
        raise ValueError("chunks input and SQLite database output must be different paths")
    database_path.parent.mkdir(parents=True, exist_ok=True)
    count = skipped = 0
    connection = sqlite3.connect(str(database_path))
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE IF NOT EXISTS chunk_metadata (chunk_id TEXT PRIMARY KEY, document_id TEXT, tenant_id TEXT, metadata_json TEXT NOT NULL)")
        connection.execute("CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(chunk_id UNINDEXED, document_id UNINDEXED, tenant_id UNINDEXED, text, metadata_json UNINDEXED, tokenize='unicode61')")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM chunk_fts")
        connection.execute("DELETE FROM chunk_metadata")
        for item in read_chunks(chunks_path):
            if not is_approved(item) or not item["text"].strip():
                skipped += 1
                continue
            chunk_id = item["chunkId"]
            tenant = item.get("tenantId")
            metadata = json.dumps({k: item.get(k) for k in ("source", "span", "quality", "contentHash")}, ensure_ascii=False, sort_keys=True)
            connection.execute("INSERT INTO chunk_fts(chunk_id, document_id, tenant_id, text, metadata_json) VALUES(?,?,?,?,?)",
                               (chunk_id, item.get("documentId"), tenant, item["text"], metadata))
            connection.execute("INSERT INTO chunk_metadata(chunk_id, document_id, tenant_id, metadata_json) VALUES(?,?,?,?)",
                               (chunk_id, item.get("documentId"), tenant, metadata))
            count += 1
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
    return {"indexed": count, "skippedNotApprovedOrEmpty": skipped}

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunks", required=True)
    parser.add_argument("--database", required=True)
    args = parser.parse_args(argv)
    try:
        result = build_index(Path(args.chunks), Path(args.database))
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f"index build failed: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
