import unittest
from chunk_documents import chunk_document, split_text
from retrieve import approved, search, tenant_allowed

def make_chunk(text, chunk_id, license_status="APPROVED", review="approved", privacy="approved", tenant=None):
    return {
        "chunkId": chunk_id, "documentId": "doc-" + chunk_id, "text": text,
        "source": {"uri": chunk_id + ".md", "licenseStatus": license_status},
        "quality": {"reviewStatus": review, "privacyStatus": privacy},
        "tenantId": tenant, "span": {"startChar": 0, "endChar": len(text)},
    }

class ChunkTests(unittest.TestCase):
    def test_empty_and_invalid_documents(self):
        with self.assertRaises(ValueError):
            chunk_document({"documentId": "x", "content": {"text": "  "}})
        with self.assertRaises(ValueError):
            chunk_document({"content": {"text": "text"}})

    def test_chunks_cover_text_and_have_stable_ids(self):
        text = ("alpha beta gamma delta\n\n" * 20).strip()
        doc = {"documentId": "doc1", "content": {"text": text}, "source": {"uri": "manual.md"}, "quality": {"reviewStatus": "pending"}}
        first = chunk_document(doc, max_chars=80, overlap=12)
        second = chunk_document(doc, max_chars=80, overlap=12)
        self.assertEqual([c["chunkId"] for c in first], [c["chunkId"] for c in second])
        self.assertGreater(len(first), 1)
        self.assertTrue(all(c["source"]["uri"] == "manual.md" for c in first))
        self.assertTrue(all(c["quality"]["reviewStatus"] == "pending" for c in first))
        self.assertTrue(all(c["text"] and len(c["text"]) <= 80 for c in first))
        self.assertEqual(first[0]["span"]["startChar"], 0)

    def test_overlap_validation(self):
        with self.assertRaises(ValueError):
            list(split_text("hello", 10, 10))

class RetrievalTests(unittest.TestCase):
    def test_only_fully_approved_records_are_searchable(self):
        chunks = [
            make_chunk("RouterOS DHCP lease troubleshooting", "good"),
            make_chunk("RouterOS DHCP lease troubleshooting", "pending", review="pending"),
            make_chunk("RouterOS DHCP lease troubleshooting", "unlicensed", license_status="REVIEW_REQUIRED"),
            make_chunk("RouterOS DHCP lease troubleshooting", "privacy", privacy="needs-human-review"),
        ]
        results = search(chunks, "DHCP troubleshooting")
        self.assertEqual([r["chunkId"] for r in results], ["good"])
        self.assertTrue(approved(chunks[0]))

    def test_tenant_isolation_and_global_records(self):
        global_doc = make_chunk("database connection pooling", "global")
        tenant_a = make_chunk("private tenant database notes", "tenant-a", tenant="tenant-a")
        tenant_b = make_chunk("private tenant database notes", "tenant-b", tenant="tenant-b")
        self.assertFalse(tenant_allowed(tenant_a, None))
        self.assertTrue(tenant_allowed(tenant_a, "tenant-a"))
        self.assertFalse(tenant_allowed(tenant_b, "tenant-a"))
        results = search([global_doc, tenant_a, tenant_b], "database", tenant_id="tenant-a")
        self.assertEqual({r["chunkId"] for r in results}, {"global", "tenant-a"})
        unscoped = search([tenant_a, tenant_b], "database")
        self.assertEqual(unscoped, [])

    def test_relevance_and_empty_queries(self):
        chunks = [make_chunk("MikroTik RouterOS DHCP", "router"), make_chunk("Business invoice accounts", "finance")]
        self.assertEqual(search(chunks, "MikroTik DHCP")[0]["chunkId"], "router")
        self.assertEqual(search(chunks, "!!!"), [])

if __name__ == "__main__":
    unittest.main()
