import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from source_connectors import make_document, redact, TextExtractor
from build_index import build_index
from search_index import search_index

def chunk(chunk_id, text, tenant=None, approved=True):
    return {
        "chunkId": chunk_id, "documentId": "doc-" + chunk_id, "tenantId": tenant,
        "text": text, "span": {"startChar": 0, "endChar": len(text)},
        "source": {"uri": chunk_id + ".md", "licenseStatus": "APPROVED" if approved else "REVIEW_REQUIRED"},
        "quality": {"reviewStatus": "approved" if approved else "pending", "privacyStatus": "approved" if approved else "needs-human-review"},
        "contentHash": "sha256:test",
    }

class ConnectorTests(unittest.TestCase):
    def test_document_has_provenance_and_defaults_to_pending(self):
        doc = make_document("https://example.org/manual", "Manual", "password=secret-value\nUse DHCP", "approved-web")
        self.assertEqual(doc["source"]["licenseStatus"], "REVIEW_REQUIRED")
        self.assertEqual(doc["quality"]["reviewStatus"], "pending")
        self.assertEqual(doc["quality"]["privacyStatus"], "needs-human-review")
        self.assertIn("[REDACTED]", doc["content"]["text"])
        self.assertTrue(doc["source"]["contentHash"].startswith("sha256:"))
        self.assertNotEqual(doc["source"]["contentHash"], doc["content"]["contentHash"])

    def test_web_connector_rejects_non_https_and_non_allowlisted_hosts(self):
        from source_connectors import _validate_public_https
        with self.assertRaises(ValueError):
            _validate_public_https("http://example.org/page", {"example.org"})
        with self.assertRaises(ValueError):
            _validate_public_https("https://example.org/page", {"other.example"})

    def test_html_extractor_skips_script_and_style(self):
        parser = TextExtractor()
        parser.feed("<html><title>Router guide</title><script>secret()</script><p>Configure DHCP</p></html>")
        self.assertIn("Configure DHCP", parser.text())
        self.assertNotIn("secret()", parser.text())

    def test_redaction_counts(self):
        text, counts = redact("Contact a.person@example.org; password=hunter2")
        self.assertEqual(counts["emails"], 1)
        self.assertEqual(counts["secrets"], 1)
        self.assertNotIn("hunter2", text)

class IndexTests(unittest.TestCase):
    def test_index_only_approved_and_preserves_citations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chunks = root / "chunks.jsonl"
            db = root / "knowledge.sqlite"
            records = [
                chunk("global", "RouterOS DHCP lease troubleshooting"),
                chunk("pending", "RouterOS DHCP secret notes", approved=False),
                chunk("tenant-a", "private invoice ledger database", tenant="tenant-a"),
                chunk("tenant-b", "private invoice ledger database", tenant="tenant-b"),
            ]
            chunks.write_text("".join(json.dumps(item) + "\n" for item in records), encoding="utf-8")
            result = build_index(chunks, db)
            self.assertEqual(result, {"indexed": 3, "skippedNotApprovedOrEmpty": 1})
            global_results = search_index(db, "RouterOS DHCP")
            self.assertEqual([r["chunkId"] for r in global_results], ["global"])
            tenant_a = search_index(db, "invoice ledger", tenant_id="tenant-a")
            self.assertEqual({r["chunkId"] for r in tenant_a}, {"tenant-a", "tenant-b"} if False else {"tenant-a"})
            self.assertEqual(tenant_a[0]["source"]["uri"], "tenant-a.md")
            self.assertEqual(search_index(db, "invoice ledger"), [])
    def test_rebuild_replaces_old_index_and_handles_empty_query(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            chunks, db = root / "chunks.jsonl", root / "index.sqlite"
            chunks.write_text(json.dumps(chunk("one", "MikroTik routing")) + "\n", encoding="utf-8")
            build_index(chunks, db)
            chunks.write_text(json.dumps(chunk("two", "business invoices")) + "\n", encoding="utf-8")
            build_index(chunks, db)
            self.assertEqual(search_index(db, "MikroTik"), [])
            self.assertEqual(search_index(db, "   "), [])

if __name__ == "__main__":
    unittest.main()
