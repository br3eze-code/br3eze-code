#!/usr/bin/env python3
"""Small-scale, provider-neutral SQLite semantic index for approved knowledge chunks.

The backend stores vectors as JSON and ranks by cosine similarity. For large corpora,
replace this adapter with a vector database without changing the embedding port or
AgentRuntime. Only explicitly approved content is embedded or searchable.
"""
from __future__ import annotations

import json
import math
import sqlite3
from pathlib import Path
from typing import Any, Iterable, Sequence

from embedding_port import EmbeddingProvider, validate_embeddings


def is_approved(item: dict[str, Any]) -> bool:
    source = item.get("source") or {}
    quality = item.get("quality") or {}
    return (
        source.get("licenseStatus") == "APPROVED"
        and quality.get("reviewStatus") == "approved"
        and quality.get("privacyStatus") == "approved"
    )


def read_chunks(path: Path) -> Iterable[dict[str, Any]]:
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


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        raise ValueError("cosine similarity requires equal, non-empty vectors")
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return dot / (left_norm * right_norm)


def build_vector_index(chunks_path: Path, database_path: Path,
                       embedder: EmbeddingProvider, batch_size: int = 32) -> dict[str, int]:
    chunks_path, database_path = Path(chunks_path), Path(database_path)
    if chunks_path.resolve() == database_path.resolve():
        raise ValueError("chunks input and SQLite database output must be different paths")
    if not 1 <= batch_size <= 512:
        raise ValueError("batch_size must be between 1 and 512")
    database_path.parent.mkdir(parents=True, exist_ok=True)
    approved = [item for item in read_chunks(chunks_path) if is_approved(item) and item["text"].strip()]
    connection = sqlite3.connect(str(database_path))
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("""CREATE TABLE IF NOT EXISTS semantic_chunks (
            chunk_id TEXT PRIMARY KEY, document_id TEXT, tenant_id TEXT,
            text TEXT NOT NULL, metadata_json TEXT NOT NULL,
            vector_json TEXT NOT NULL, dimension INTEGER NOT NULL
        )""")
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM semantic_chunks")
        dimension: int | None = None
        indexed = 0
        for start in range(0, len(approved), batch_size):
            batch = approved[start:start + batch_size]
            vectors, dimension = validate_embeddings(
                embedder.embed([item["text"] for item in batch]), len(batch), dimension
            )
            rows = []
            for item, vector in zip(batch, vectors):
                metadata = {key: value for key, value in item.items() if key not in {"text", "chunkId", "documentId", "tenantId"}}
                rows.append((
                    item["chunkId"], item.get("documentId"), item.get("tenantId"),
                    item["text"], json.dumps(metadata, ensure_ascii=False, sort_keys=True),
                    json.dumps(vector, separators=(",", ":")), dimension,
                ))
            connection.executemany(
                "INSERT INTO semantic_chunks VALUES (?, ?, ?, ?, ?, ?, ?)", rows
            )
            indexed += len(rows)
        connection.commit()
        return {"indexed": indexed, "skippedNotApprovedOrEmpty": sum(
            1 for item in read_chunks(chunks_path) if not is_approved(item) or not item["text"].strip()
        )}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def search_vector_index(database_path: Path, query: str, embedder: EmbeddingProvider,
                        limit: int = 5, tenant_id: str | None = None) -> list[dict[str, Any]]:
    if not query.strip():
        return []
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    connection = sqlite3.connect(str(database_path))
    connection.row_factory = sqlite3.Row
    try:
        if tenant_id is None:
            rows = connection.execute(
                "SELECT * FROM semantic_chunks WHERE tenant_id IS NULL OR tenant_id=''"
            ).fetchall()
        else:
            rows = connection.execute(
                "SELECT * FROM semantic_chunks WHERE tenant_id IS NULL OR tenant_id='' OR tenant_id=?",
                (tenant_id,),
            ).fetchall()
        if not rows:
            return []
        query_vectors, _ = validate_embeddings(embedder.embed([query]), 1, rows[0]["dimension"])
        query_vector = query_vectors[0]
        ranked = []
        for row in rows:
            vector = json.loads(row["vector_json"])
            metadata = json.loads(row["metadata_json"])
            ranked.append({
                "score": round(cosine_similarity(query_vector, vector), 6),
                "chunkId": row["chunk_id"],
                "documentId": row["document_id"],
                "source": metadata.get("source", {}),
                "span": metadata.get("span", {}),
                "text": row["text"],
            })
        ranked.sort(key=lambda item: item["score"], reverse=True)
        return ranked[:limit]
    finally:
        connection.close()
