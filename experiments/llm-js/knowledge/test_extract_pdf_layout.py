import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from extract_pdf_layout import extract_pdf_layout, _markdown_table


class FakePage:
    def __init__(self, text, tables):
        self._text = text
        self._tables = tables
    def extract_text(self):
        return self._text
    def extract_tables(self):
        return self._tables


class FakePdf:
    def __init__(self, pages):
        self.pages = pages
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


class PdfLayoutTests(unittest.TestCase):
    def test_table_is_preserved_as_markdown(self):
        value = _markdown_table([["Name", "Value"], ["DHCP", "Enabled"]])
        self.assertIn("| Name | Value |", value)
        self.assertIn("| DHCP | Enabled |", value)

    def test_extracts_pages_tables_and_citation_markers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "guide.pdf"
            path.write_bytes(b"fake pdf bytes")
            fake_module = types.SimpleNamespace(open=lambda _path: FakePdf([
                FakePage("Router overview", [[["Setting", "Value"], ["DHCP", "enabled"]]]),
                FakePage("Routing overview", []),
            ]))
            with patch.dict(sys.modules, {"pdfplumber": fake_module}):
                doc = extract_pdf_layout(path, "docs/router-guide.pdf")
            self.assertEqual(doc["source"]["pageCount"], 2)
            self.assertEqual(doc["source"]["licenseStatus"], "REVIEW_REQUIRED")
            self.assertIn("[PDF page 1]", doc["content"]["text"])
            self.assertIn("[PDF page 2]", doc["content"]["text"])
            self.assertIn("| DHCP | enabled |", doc["content"]["text"])
            self.assertEqual(doc["content"]["layout"]["pages"][0]["tables"][0]["tableIndex"], 1)
            self.assertEqual(doc["quality"]["reviewStatus"], "pending")
            self.assertFalse(doc["quality"]["ocrOrVisionGenerated"])

    def test_rejects_missing_and_non_pdf_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.pdf"
            with self.assertRaises(ValueError):
                extract_pdf_layout(missing)
            txt = Path(directory) / "manual.txt"
            txt.write_text("not a PDF")
            with self.assertRaises(ValueError):
                extract_pdf_layout(txt)


if __name__ == "__main__":
    unittest.main()
