import json
import math
import tempfile
import unittest
from pathlib import Path

from embedding_port import validate_embeddings
from vector_index import build_vector_index, cosine_similarity, search_vector_index


class FakeEmbedder:
    def embed(self, texts):
        # Deterministic test fixture only; production callers supply a real model adapter.
        result = []
        for text in texts:
            value = text.lower()
            result.append([
                float("router" in value or "network" in value),
                float("invoice" in value or "finance" in value),
                float("dhcp" in value),
            ])
        return result


def chunk(chunk_id, text, tenant=None, approved=True):
    return {
        "chunkId": chunk_id, "documentId": "doc-" + chunk_id, "tenantId": tenant,
        "text": text,
        "source": {"uri": chunk_id + ".pdf", "licenseStatus": "APPROVED" if approved else "REVIEW_REQUIRED"},
        "quality": {"reviewStatus": "approved" if approved else "pending",
                    "privacyStatus": "approved" if approved else "needs-human-review"},
        "span": {"startChar": 0, "endChar": len(text)},
    }


class EmbeddingPortTests(unittest.TestCase):
    def test_rejects_wrong_count_dimension_and_non_finite_values(self):
        with self.assertRaises(ValueError):
            validate_embeddings([[1.0]], 2)
        with self.assertRaises(ValueError):
            validate_embeddings([[1.0], [1.0, 2.0]], 2)
        with self.assertRaises(ValueError):
            validate_embeddings([[math.inf]], 1)

    def test_cosine_similarity(self):
        self.assertAlmostEqual(cosine_similarity([1, 0], [2, 0]), 1.0)
        self.assertAlmostEqual(cosine_similarity([1, 0], [0, 1]), 0.0)
        with self.assertRaises(ValueError):
            cosine_similarity([1], [1, 2])

    def test_index_only_approved_and_isolates_tenants(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "chunks.jsonl"
            database = root / "semantic.sqlite"
            records = [
                chunk("router", "Router network configuration"),
                chunk("finance-a", "Invoice finance ledger", tenant="tenant-a"),
                chunk("finance-b", "Invoice finance records", tenant="tenant-b"),
                chunk("pending", "Router DHCP pending", approved=False),
            ]
            source.write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")
            stats = build_vector_index(source, database, FakeEmbedder(), batch_size=2)
            self.assertEqual(stats, {"indexed": 3, "skippedNotApprovedOrEmpty": 1})
            global_results = search_vector_index(database, "Router network", FakeEmbedder())
            self.assertEqual([item["chunkId"] for item in global_results], ["router"])
            tenant_results = search_vector_index(database, "Invoice finance", FakeEmbedder(), tenant_id="tenant-a")
            self.assertEqual({item["chunkId"] for item in tenant_results}, {"finance-a"})
            self.assertEqual(tenant_results[0]["source"]["uri"], "finance-a.pdf")
            self.assertEqual(search_vector_index(database, "Invoice finance", FakeEmbedder()), [])


if __name__ == "__main__":
    unittest.main()
