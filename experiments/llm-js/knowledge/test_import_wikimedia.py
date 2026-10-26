import unittest
from import_wikimedia import make_document, normalize_title, parse_api_response

class WikimediaAdapterTests(unittest.TestCase):
    def setUp(self):
        self.payload = {"query": {"pages": [{
            "pageid": 42, "ns": 0, "title": "Example article", "lastrevid": 1234,
            "fullurl": "https://en.wikipedia.org/wiki/Example_article",
            "extract": "An example article.\n\nIt has two paragraphs."
        }]}}

    def test_parse_and_normalize_page(self):
        page = parse_api_response(self.payload)
        self.assertEqual(page["pageId"], 42)
        self.assertEqual(page["revisionId"], 1234)
        self.assertIn("Example_article", page["url"])
        self.assertFalse(page["truncated"])

    def test_document_keeps_attribution_and_requires_review(self):
        page = parse_api_response(self.payload)
        document = make_document(page, retrieved_at="2026-10-26T00:00:00+00:00")
        self.assertEqual(document["schemaVersion"], "1.0")
        self.assertEqual(document["source"]["licenseStatus"], "REVIEW_REQUIRED")
        self.assertIn("Wikipedia contributors", document["source"]["attribution"])
        self.assertEqual(document["source"]["revisionId"], 1234)
        self.assertEqual(document["quality"]["reviewStatus"], "pending")
        self.assertTrue(document["source"]["contentHash"].startswith("sha256:"))
        self.assertTrue(document["content"]["contentHash"].startswith("sha256:"))

    def test_truncation_is_explicit(self):
        page = parse_api_response(self.payload, max_chars=8)
        self.assertEqual(page["text"], "An examp")
        self.assertTrue(page["truncated"])

    def test_missing_page_and_bad_url_rejected(self):
        with self.assertRaises(ValueError):
            parse_api_response({"query": {"pages": [{"missing": True, "title": "Gone"}]}})
        page = parse_api_response(self.payload)
        page["url"] = "https://example.com/fake"
        with self.assertRaises(ValueError):
            make_document(page)

    def test_title_validation(self):
        self.assertEqual(normalize_title("  New   York  "), "New York")
        for bad in ("", "x\nadmin", "x" * 256):
            with self.assertRaises(ValueError):
                normalize_title(bad)

if __name__ == "__main__":
    unittest.main()
