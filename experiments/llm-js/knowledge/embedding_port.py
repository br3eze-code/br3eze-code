"""Provider-neutral embedding port for AgentOS knowledge retrieval.

Provider adapters implement embed(texts) and return one numeric vector per input.
No model, vendor SDK, or credentials are required by the domain-neutral core.
"""
from __future__ import annotations

import math
from typing import Protocol, Sequence, runtime_checkable


@runtime_checkable
class EmbeddingProvider(Protocol):
    def embed(self, texts: Sequence[str]) -> Sequence[Sequence[float]]:
        """Return one finite, non-empty, fixed-dimension vector per text."""
        ...


def validate_embeddings(vectors: Sequence[Sequence[float]], expected_count: int,
                        dimension: int | None = None) -> tuple[list[list[float]], int]:
    if len(vectors) != expected_count:
        raise ValueError(f"embedding provider returned {len(vectors)} vectors for {expected_count} texts")
    normalized: list[list[float]] = []
    found_dimension = dimension
    for index, vector in enumerate(vectors):
        if isinstance(vector, (str, bytes)) or not vector:
            raise ValueError(f"embedding {index} must be a non-empty numeric vector")
        row: list[float] = []
        for value in vector:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                raise ValueError(f"embedding {index} contains a non-finite or non-numeric value")
            row.append(float(value))
        if found_dimension is None:
            found_dimension = len(row)
        if len(row) != found_dimension:
            raise ValueError(f"embedding {index} has dimension {len(row)}; expected {found_dimension}")
        normalized.append(row)
    if found_dimension is None or found_dimension < 1:
        raise ValueError("embedding dimension must be positive")
    return normalized, found_dimension
