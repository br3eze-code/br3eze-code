import argparse, json, tempfile, unittest
from pathlib import Path
from ingest import build, html_to_text, redact

class KnowledgeIngestionTests(unittest.TestCase):
 def test_redacts_secret_email_and_ip(self):
  value,counts=redact("password=abc123 test@example.com 192.168.1.10")
  self.assertNotIn("abc123",value); self.assertNotIn("test@example.com",value); self.assertNotIn("192.168.1.10",value)
  self.assertEqual(counts["credentialPatterns"],1); self.assertEqual(counts["emails"],1); self.assertEqual(counts["ipv4Addresses"],1)
 def test_html_removes_script_and_tags(self):
  value=html_to_text("<h1>Hello</h1><script>alert('x')</script><p>World</p>")
  self.assertIn("Hello",value); self.assertIn("World",value); self.assertNotIn("alert",value)
 def test_build_provenance_dedup_and_secret_skip(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/"input"; out=Path(tmp)/"output"; root.mkdir()
   (root/"one.md").write_text("Same content; email a@b.com",encoding="utf-8")
   (root/"two.txt").write_text("Same content; email a@b.com",encoding="utf-8")
   (root/".env").write_text("API_KEY=do-not-ingest",encoding="utf-8")
   manifest=build(argparse.Namespace(input_root=str(root),output=str(out),license_status="REVIEW_REQUIRED",max_file_bytes=10000,ocr=False))
   rows=[json.loads(line) for line in (out/"documents.jsonl").read_text(encoding="utf-8").splitlines()]
   self.assertEqual(len(rows),1); self.assertEqual(manifest["totals"]["duplicates"],1)
   self.assertEqual(rows[0]["source"]["licenseStatus"],"REVIEW_REQUIRED")
   self.assertEqual(rows[0]["quality"]["reviewStatus"],"pending")
   self.assertIn("[REDACTED_EMAIL]",rows[0]["content"]["text"])
   self.assertTrue(rows[0]["source"]["contentHash"].startswith("sha256:"))
 def test_refuses_output_inside_input(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/"input"; root.mkdir()
   with self.assertRaises(ValueError):
    build(argparse.Namespace(input_root=str(root),output=str(root/"out"),license_status="REVIEW_REQUIRED",max_file_bytes=10000,ocr=False))
 def test_oversized_file_is_skipped(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp)/"input"; out=Path(tmp)/"output"; root.mkdir()
   (root/"large.txt").write_text("x"*50,encoding="utf-8")
   manifest=build(argparse.Namespace(input_root=str(root),output=str(out),license_status="REVIEW_REQUIRED",max_file_bytes=10,ocr=False))
   self.assertEqual(manifest["totals"]["documentsWritten"],0); self.assertIn("exceeds",manifest["skipped"][0]["reason"])
if __name__=="__main__": unittest.main()
