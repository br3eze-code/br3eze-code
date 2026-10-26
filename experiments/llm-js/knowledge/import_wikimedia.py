#!/usr/bin/env python3
"""Fetch explicitly named Wikipedia pages into AgentOS's provenance-first JSONL format.

This is a bounded source adapter, not a crawler. It fetches only titles listed by
the operator and only from the fixed Wikimedia API endpoint. Rights remain
REVIEW_REQUIRED; importing a page does not grant permission to train on it.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

API_ENDPOINT = "https://en.wikipedia.org/w/api.php"
SCHEMA_VERSION = "1.0"
USER_AGENT = "AgentOSKnowledgeImporter/0.1 (operator-authorized; contact repository maintainer)"
MAX_TITLES = 50
DEFAULT_MAX_CHARS = 100_000

def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def normalize_title(title: str) -> str:
    title = " ".join(title.strip().split())
    if not title or len(title) > 255 or any(ord(ch) < 32 for ch in title):
        raise ValueError("title must be non-empty, at most 255 characters, and contain no control characters")
    return title

def parse_api_response(payload: dict[str, Any], max_chars: int = DEFAULT_MAX_CHARS) -> dict[str, Any]:
    pages = payload.get("query", {}).get("pages")
    if not isinstance(pages, list) or len(pages) != 1 or not isinstance(pages[0], dict):
        raise ValueError("unexpected Wikimedia API response shape")
    page = pages[0]
    if page.get("missing") is not None:
        raise ValueError("page does not exist")
    title = page.get("title")
    extract = page.get("extract")
    pageid = page.get("pageid")
    if not isinstance(title, str) or not isinstance(extract, str) or not isinstance(pageid, int):
        raise ValueError("Wikimedia response is missing title, extract, or page ID")
    canonical = page.get("fullurl")
    if not isinstance(canonical, str) or not canonical.startswith("https://en.wikipedia.org/wiki/"):
        raise ValueError("unexpected canonical page URL")
    if not extract.strip():
        raise ValueError("page has no extractable text")
    return {
        "title": title,
        "pageId": pageid,
        "revisionId": page.get("lastrevid"),
        "url": canonical,
        "text": extract[:max_chars],
        "truncated": len(extract) > max_chars,
    }

def make_document(page: dict[str, Any], retrieved_at: str | None = None) -> dict[str, Any]:
    title = page["title"]
    text = page["text"].strip()
    if not text:
        raise ValueError("cannot create a document with empty text")
    source_url = page["url"]
    if not source_url.startswith("https://en.wikipedia.org/wiki/"):
        raise ValueError("source URL must be an English Wikipedia article URL")
    timestamp = retrieved_at or datetime.now(timezone.utc).isoformat()
    text_hash = sha256(text)
    identity = f"wikimedia:{page['pageId']}:{page.get('revisionId') or 'unknown'}:{text_hash}"
    return {
        "schemaVersion": SCHEMA_VERSION,
        "documentId": sha256(identity)[:24],
        "source": {
            "uri": source_url,
            "sourceType": "wikimedia-api",
            "mediaType": "text",
            "contentHash": "sha256:" + sha256(json.dumps(page, sort_keys=True, ensure_ascii=False)),
            "licenseStatus": "REVIEW_REQUIRED",
            "retrievedAt": timestamp,
            "attribution": title + " — Wikipedia contributors",
            "pageId": page["pageId"],
            "revisionId": page.get("revisionId"),
            "licenseReviewRequired": True,
        },
        "content": {
            "modality": "text",
            "text": text,
            "contentHash": "sha256:" + text_hash,
            "truncated": bool(page.get("truncated", False)),
        },
        "quality": {
            "reviewStatus": "pending",
            "privacyStatus": "needs-human-review",
            "redactions": {"credentialPatterns": 0, "emails": 0, "ipv4Addresses": 0},
        },
    }

def fetch_title(title: str, max_chars: int = DEFAULT_MAX_CHARS, timeout: float = 15.0) -> dict[str, Any]:
    title = normalize_title(title)
    params = {
        "action": "query", "prop": "extracts|info", "inprop": "url",
        "explaintext": "1", "exsectionformat": "plain", "redirects": "1",
        "titles": title, "format": "json", "formatversion": "2",
    }
    url = API_ENDPOINT + "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"Wikimedia API returned HTTP {response.status}")
        raw = response.read(8_000_001)
    if len(raw) > 8_000_000:
        raise ValueError("Wikimedia response exceeded 8 MB safety limit")
    payload = json.loads(raw.decode("utf-8"))
    return parse_api_response(payload, max_chars=max_chars)

def import_titles(titles: list[str], max_chars: int = DEFAULT_MAX_CHARS, delay: float = 0.5) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    if len(titles) > MAX_TITLES:
        raise ValueError(f"at most {MAX_TITLES} titles per run; use reviewed batches")
    documents, failures = [], []
    seen: set[str] = set()
    for title in titles:
        if not title.strip() or title.lstrip().startswith("#"):
            continue
        try:
            page = fetch_title(title, max_chars=max_chars)
            document = make_document(page)
            if document["content"]["contentHash"] in seen:
                continue
            seen.add(document["content"]["contentHash"])
            documents.append(document)
        except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
            failures.append({"title": title[:255], "reason": str(exc)})
        # Be polite to the public API even when a previous request failed.
        if delay:
            time.sleep(delay)
    return documents, failures

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--titles-file", required=True, help="UTF-8 file with one explicitly approved article title per line")
    parser.add_argument("--output", required=True, help="output JSONL path, must not overwrite the titles file")
    parser.add_argument("--max-chars", type=int, default=DEFAULT_MAX_CHARS)
    parser.add_argument("--delay-seconds", type=float, default=0.5)
    args = parser.parse_args(argv)
    if not 1 <= args.max_chars <= DEFAULT_MAX_CHARS:
        parser.error(f"--max-chars must be between 1 and {DEFAULT_MAX_CHARS}")
    if not 0 <= args.delay_seconds <= 30:
        parser.error("--delay-seconds must be between 0 and 30")
    titles_path, output_path = Path(args.titles_file).resolve(), Path(args.output).resolve()
    if titles_path == output_path:
        parser.error("output must not overwrite the titles file")
    try:
        titles = titles_path.read_text(encoding="utf-8").splitlines()
        documents, failures = import_titles(titles, args.max_chars, args.delay_seconds)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("w", encoding="utf-8", newline="\n") as stream:
            for document in documents:
                stream.write(json.dumps(document, ensure_ascii=False, sort_keys=True) + "\n")
        report = {"documentsWritten": len(documents), "failures": failures, "licenseStatusDefault": "REVIEW_REQUIRED",
                  "policy": {"boundedTitleList": True, "maxTitles": MAX_TITLES, "trainingPermissionNotImplied": True}}
        output_path.with_suffix(output_path.suffix + ".manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"documentsWritten": len(documents), "failures": len(failures), "manifest": str(output_path) + ".manifest.json"}, indent=2))
        return 0 if documents or not failures else 2
    except (OSError, ValueError) as exc:
        print(f"Wikimedia import failed: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
