#!/usr/bin/env python3
"""Extract PDF page text and tables while preserving page-level citations.

Requires optional pdfplumber. This module does not perform OCR or vision inference;
scanned pages remain flagged for a separate reviewed OCR/vision stage.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _cell(value: Any) -> str:
    return " ".join(str(value or "").replace("|", "\\|").split())


def _markdown_table(rows: list[list[Any]]) -> str:
    normalized = [[_cell(cell) for cell in row] for row in rows if row and any(_cell(cell) for cell in row)]
    if not normalized:
        return ""
    width = max(len(row) for row in normalized)
    normalized = [row + [""] * (width - len(row)) for row in normalized]
    header = normalized[0]
    separator = ["---"] * width
    lines = ["| " + " | ".join(header) + " |", "| " + " | ".join(separator) + " |"]
    lines.extend("| " + " | ".join(row) + " |" for row in normalized[1:])
    return "\n".join(lines)


def extract_pdf_layout(pdf_path: Path, source_uri: str | None = None,
                       license_status: str = "REVIEW_REQUIRED") -> dict[str, Any]:
    pdf_path = Path(pdf_path)
    if not pdf_path.is_file():
        raise ValueError(f"PDF file does not exist: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("input must be a .pdf file")
    if license_status not in {"REVIEW_REQUIRED", "APPROVED", "RESTRICTED"}:
        raise ValueError("invalid license status")
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError("PDF layout/table extraction requires optional dependency pdfplumber") from exc

    pages: list[dict[str, Any]] = []
    text_sections: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            page_text = (page.extract_text() or "").strip()
            raw_tables = page.extract_tables() or []
            tables: list[dict[str, Any]] = []
            table_sections: list[str] = []
            for table_index, rows in enumerate(raw_tables, start=1):
                markdown = _markdown_table(rows or [])
                if not markdown:
                    continue
                tables.append({"tableIndex": table_index, "format": "markdown", "text": markdown})
                table_sections.append(f"[Table {table_index}, PDF page {page_number}]\n{markdown}")
            if not page_text and not table_sections:
                status = "needs-ocr-or-vision"
            else:
                status = "text-extracted"
            sections = [f"[PDF page {page_number}]"]
            if page_text:
                sections.append(page_text)
            sections.extend(table_sections)
            text_sections.append("\n".join(sections))
            pages.append({
                "pageNumber": page_number,
                "text": page_text,
                "tables": tables,
                "extractionStatus": status,
            })

    combined = "\n\n".join(text_sections).strip()
    if not combined:
        raise ValueError("PDF has no extractable text or tables; OCR/vision is a separate optional stage")
    raw_bytes = pdf_path.read_bytes()
    digest = sha256(raw_bytes)
    now = datetime.now(timezone.utc).isoformat()
    uri = source_uri or pdf_path.name
    normalized_digest = sha256(combined.encode("utf-8"))
    return {
        "schemaVersion": "1.0",
        "documentId": hashlib.sha256((uri + "\\0" + digest).encode("utf-8")).hexdigest()[:32],
        "source": {
            "uri": uri,
            "sourceType": "local-pdf-layout",
            "mediaType": "pdf",
            "contentHash": "sha256:" + digest,
            "licenseStatus": license_status,
            "retrievedAt": now,
            "pageCount": len(pages),
        },
        "content": {
            "modality": "pdf-layout-text",
            "text": combined,
            "contentHash": "sha256:" + normalized_digest,
            "layout": {"pages": pages, "citationFormat": "[PDF page N]"},
        },
        "quality": {
            "reviewStatus": "pending",
            "privacyStatus": "needs-human-review",
            "redactions": {"credentialPatterns": 0, "emails": 0, "ipv4Addresses": 0},
            "requiresPrivacyRedactionReview": True,
            "ocrOrVisionGenerated": False,
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="authorized local PDF file")
    parser.add_argument("--output", required=True, help="output normalized document JSONL")
    parser.add_argument("--source-uri", help="optional stable source URI/identifier")
    parser.add_argument("--license-status", choices=("REVIEW_REQUIRED", "APPROVED", "RESTRICTED"), default="REVIEW_REQUIRED")
    args = parser.parse_args(argv)
    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    if source == output:
        parser.error("input and output must be different files")
    try:
        document = extract_pdf_layout(source, args.source_uri, args.license_status)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(document, ensure_ascii=False, sort_keys=True) + "\\n", encoding="utf-8")
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"PDF extraction failed: {exc}", file=sys.stderr)
        return 2
    print(json.dumps({"documentId": document["documentId"], "pages": document["source"]["pageCount"], "output": str(output), "reviewRequired": True}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
