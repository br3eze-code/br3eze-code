#!/usr/bin/env python3
"""Search the approved AgentOS SQLite FTS5 index with tenant isolation."""
from __future__ import annotations
import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

def search_index(database: Path, query: str, limit: int = 5, tenant_id: str | None = None) -> list[dict[str, Any]]:
    if not query.strip():
        return []
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    connection = sqlite3.connect(str(database))
    connection.row_factory = sqlite3.Row
    try:
        if tenant_id is None:
            rows = connection.execute(
                "SELECT chunk_id, document_id, text, metadata_json, bm25(chunk_fts) AS rank "
                "FROM chunk_fts WHERE chunk_fts MATCH ? AND (tenant_id IS NULL OR tenant_id='') "
                "ORDER BY rank ASC LIMIT ?", (query, limit)
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT chunk_id, document_id, text, metadata_json, bm25(chunk_fts) AS rank "
                "FROM chunk_fts WHERE chunk_fts MATCH ? AND (tenant_id IS NULL OR tenant_id='' OR tenant_id=?) "
                "ORDER BY rank ASC LIMIT ?", (query, tenant_id, limit)
            ).fetchall()
        results = []
        for row in rows:
            metadata = json.loads(row["metadata_json"])
            results.append({
                "score": round(-float(row["rank"]), 6),
                "chunkId": row["chunk_id"], "documentId": row["document_id"],
                "source": metadata.get("source", {}), "span": metadata.get("span", {}),
                "text": row["text"],
            })
        return results
    except sqlite3.OperationalError as exc:
        # FTS query syntax errors are user input errors, not a server crash.
        if "syntax error" in str(exc).lower() or "fts5" in str(exc).lower():
            return []
        raise
    finally:
        connection.close()

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True)
    parser.add_argument("--query", required=True)
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--tenant-id")
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 100:
        parser.error("--limit must be between 1 and 100")
    try:
        results = search_index(Path(args.database), args.query, args.limit, args.tenant_id)
        print(json.dumps({"query": args.query, "results": results}, ensure_ascii=False, indent=2))
        return 0
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(f"search failed: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
