import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("prepare_dataset.py")


def case(case_id, family, split):
    return {
        "schemaVersion": "1.0",
        "caseId": case_id,
        "domain": "networking",
        "platform": "mikrotik-routeros",
        "task": "root-cause-diagnosis",
        "faultFamily": family,
        "input": {"symptom": "Client cannot resolve a hostname", "evidence": {"publicIpReachable": True}},
        "target": {"rootCause": family, "supportingEvidence": ["Public IP works"], "nextTest": "Check DNS resolution"},
        "verification": {"source": "isolated-simulator", "causeConfirmed": True, "recoveryConfirmed": True},
        "reviewStatus": "approved",
        "split": split,
    }


class PrepareDatasetTests(unittest.TestCase):
    def run_builder(self, cases):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        corpus = root / "docs"
        corpus.mkdir()
        (corpus / "routeros.md").write_text(
            "RouterOS documentation example. " * 8 + "\npassword=supersecret 192.0.2.15\n",
            encoding="utf-8",
        )
        case_file = root / "cases.jsonl"
        case_file.write_text("".join(json.dumps(row) + "\n" for row in cases), encoding="utf-8")
        out = root / "out"
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), "--corpus-root", str(corpus), "--cases", str(case_file), "--output-dir", str(out)],
            text=True, capture_output=True, check=False,
        )
        return proc, out

    def test_builds_manifest_sanitizes_secrets_and_writes_splits(self):
        proc, out = self.run_builder([
            case("dns-train-1", "dns-family", "train"),
            case("route-validation-1", "route-family", "validation"),
            case("wan-test-1", "wan-family", "test"),
        ])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        corpus = (out / "corpus.jsonl").read_text(encoding="utf-8")
        self.assertNotIn("supersecret", corpus)
        self.assertNotIn("192.0.2.15", corpus)
        self.assertIn("[REDACTED]", corpus)
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["approvedCases"], 3)
        self.assertTrue(manifest["licenseReviewRequired"])
        self.assertEqual(len((out / "cases" / "train.jsonl").read_text().splitlines()), 1)

    def test_rejects_fault_family_split_leakage(self):
        proc, _ = self.run_builder([
            case("dns-train-1", "dns-family", "train"),
            case("dns-test-1", "dns-family", "test"),
        ])
        self.assertEqual(proc.returncode, 2)
        self.assertIn("fault-family leakage", proc.stderr)

    def test_rejects_unreviewed_cases(self):
        row = case("dns-train-1", "dns-family", "train")
        row["reviewStatus"] = "candidate"
        proc, _ = self.run_builder([row])
        self.assertEqual(proc.returncode, 2)
        self.assertIn("only human/lab-approved", proc.stderr)

    def test_rejects_duplicate_case_ids(self):
        row = case("dns-train-1", "dns-family", "train")
        proc, _ = self.run_builder([row, dict(row, split="train")])
        self.assertEqual(proc.returncode, 2)
        self.assertIn("duplicate caseId", proc.stderr)


if __name__ == "__main__":
    unittest.main()
