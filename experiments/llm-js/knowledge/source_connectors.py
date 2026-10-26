#!/usr/bin/env python3
"""Controlled, provenance-preserving connectors for Wikimedia and approved HTTPS pages.

Connectors stage content as pending knowledge documents. They never approve licences,
privacy status, or training eligibility automatically.
"""
from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Any
from urllib.robotparser import RobotFileParser

USER_AGENT = "AgentOS-KnowledgeBot/0.1 (+https://br3eze.africa/knowledge-ingestion)"
MAX_BYTES = 2_000_000
TIMEOUT_SECONDS = 12
SECRET_PATTERNS = [
    re.compile(r'(?i)(\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*)(["\']?)[^\s,"\'>}]+'),
    re.compile(r'(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+'),
    re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b', re.I),
]

class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0
    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.hidden += 1
        elif tag in {"p", "div", "main", "article", "section", "li", "h1", "h2", "h3", "br"} and not self.hidden:
            self.parts.append("\n")
    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self.hidden:
            self.hidden -= 1
        elif tag in {"p", "div", "main", "article", "section", "li", "h1", "h2", "h3"} and not self.hidden:
            self.parts.append("\n")
    def handle_data(self, data: str) -> None:
        if not self.hidden and data.strip():
            self.parts.append(data.strip())
    def text(self) -> str:
        return re.sub(r"\n{3,}", "\n\n", "\n".join(self.parts)).strip()

def sha256(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()

def redact(text: str) -> tuple[str, dict[str, int]]:
    counts = {"secrets": 0, "emails": 0}
    value = text
    for pattern in SECRET_PATTERNS[:2]:
        value, n = pattern.subn(lambda m: (m.group(1) + "[REDACTED]") if len(m.groups()) > 1 else "[REDACTED]", value)
        counts["secrets"] += n
    value, counts["emails"] = SECRET_PATTERNS[2].subn("[REDACTED_EMAIL]", value)
    return value, counts

def make_document(uri: str, title: str, text: str, source_type: str, media_type: str = "text/html", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    clean, redactions = redact(text)
    normalized = re.sub(r"[ \t]+", " ", clean).strip()
    now = datetime.now(timezone.utc).isoformat()
    source: dict[str, Any] = {
        "uri": uri, "title": title[:500], "sourceType": source_type, "mediaType": media_type,
        "contentHash": sha256(text), "licenseStatus": "REVIEW_REQUIRED", "retrievedAt": now,
    }
    if extra:
        source.update(extra)
    return {
        "schemaVersion": "1.0",
        "documentId": hashlib.sha256((uri + "\0" + sha256(normalized)).encode()).hexdigest()[:32],
        "source": source,
        "content": {"modality": "text", "text": normalized, "contentHash": sha256(normalized)},
        "quality": {"reviewStatus": "pending", "privacyStatus": "needs-human-review", "redactions": redactions},
    }

def _validate_public_https(url: str, allowed_hosts: set[str]) -> urllib.parse.SplitResult:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("only credential-free HTTPS URLs are permitted")
    host = parsed.hostname.lower().rstrip(".")
    if host not in allowed_hosts:
        raise ValueError(f"host {host!r} is not on the explicit allowlist")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)}
    except OSError as exc:
        raise ValueError(f"cannot resolve approved host {host!r}: {exc}") from exc
    if not addresses:
        raise ValueError(f"host {host!r} did not resolve")
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise ValueError(f"refusing non-public destination address for {host!r}")
    return parsed

class _AllowlistedRedirect(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed_hosts: set[str]) -> None:
        super().__init__()
        self.allowed_hosts = allowed_hosts
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_public_https(newurl, self.allowed_hosts)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

def fetch_approved_page(url: str, allowed_hosts: set[str], delay_seconds: float = 1.0) -> dict[str, Any]:
    parsed = _validate_public_https(url, allowed_hosts)
    robots_url = f"https://{parsed.netloc}/robots.txt"
    robots = RobotFileParser()
    robots.set_url(robots_url)
    try:
        request = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            robots_lines = response.read(256_000).decode("utf-8", "replace").splitlines()
        robots.parse(robots_lines)
    except urllib.error.HTTPError as exc:
        if exc.code in (404, 410):
            # A missing robots file imposes no robots.txt restrictions.
            robots.parse([])
        elif exc.code in (401, 403):
            raise ValueError(f"robots.txt returned HTTP {exc.code}; refusing to crawl") from exc
        else:
            raise
    if not robots.can_fetch(USER_AGENT, url):
        raise ValueError("robots.txt disallows this URL")
    if delay_seconds > 0:
        time.sleep(min(delay_seconds, 5.0))
    opener = urllib.request.build_opener(_AllowlistedRedirect(set(allowed_hosts)))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"})
    with opener.open(request, timeout=TIMEOUT_SECONDS) as response:
        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "application/xhtml+xml", "text/plain"}:
            raise ValueError(f"unsupported content type {content_type!r}")
        payload = response.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise ValueError(f"page exceeds {MAX_BYTES} byte limit")
    raw = payload.decode("utf-8", "replace")
    if content_type == "text/plain":
        text = raw
        title = url
    else:
        parser = TextExtractor()
        parser.feed(raw)
        text = parser.text()
        title_match = re.search(r"<title[^>]*>(.*?)</title\s*>", raw, re.I | re.S)
        title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else url
    if not text:
        raise ValueError("page contained no extractable text")
    return make_document(url, title, text, "approved-web", content_type, {"licenseHint": "REVIEW_REQUIRED", "robotsChecked": True})

def search_wikimedia(query: str, limit: int = 5, language: str = "en") -> list[dict[str, Any]]:
    if not query.strip():
        raise ValueError("query must not be empty")
    if not re.fullmatch(r"[a-z-]{2,12}", language):
        raise ValueError("language must be a short language code")
    if not 1 <= limit <= 20:
        raise ValueError("limit must be between 1 and 20")
    params = urllib.parse.urlencode({
        "action": "query", "generator": "search", "gsrsearch": query, "gsrnamespace": 0,
        "gsrlimit": limit, "prop": "extracts|info", "explaintext": 1, "inprop": "url", "format": "json",
    })
    url = f"https://{language}.wikipedia.org/w/api.php?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        payload = response.read(MAX_BYTES * 4 + 1)
    if len(payload) > MAX_BYTES * 4:
        raise ValueError("Wikimedia response exceeded size limit")
    data = json.loads(payload.decode("utf-8"))
    pages = data.get("query", {}).get("pages", {})
    results = []
    for page in sorted(pages.values(), key=lambda item: int(item.get("index", 0))):
        extract = str(page.get("extract", "")).strip()
        uri = page.get("fullurl") or f"https://{language}.wikipedia.org/wiki/{urllib.parse.quote(str(page.get('title', '')).replace(' ', '_'))}"
        if not extract:
            continue
        results.append(make_document(uri, str(page.get("title", "")), extract, "wikimedia-wikipedia", "text/plain", {
            "licenseHint": "CC BY-SA; verify applicable version and attribution before reuse",
            "attribution": str(page.get("title", "")), "wikimediaPageId": page.get("pageid"),
        }))
    return results

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, help="output JSONL path")
    parser.add_argument("--wikimedia-query", action="append", default=[], help="Wikipedia search query; may be repeated")
    parser.add_argument("--language", default="en")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--url", action="append", default=[], help="explicit HTTPS URL; may be repeated")
    parser.add_argument("--allow-host", action="append", default=[], help="exact hostname allowlist entry; required for --url")
    parser.add_argument("--delay-seconds", type=float, default=1.0)
    args = parser.parse_args(argv)
    if args.url and not args.allow_host:
        parser.error("--url requires one or more explicit --allow-host values")
    allowlist = {host.lower().rstrip(".") for host in args.allow_host}
    if not args.url and not args.wikimedia_query:
        parser.error("provide --wikimedia-query and/or --url")
    output = __import__("pathlib").Path(args.output).resolve()
    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        total = 0
        with output.open("w", encoding="utf-8", newline="\n") as stream:
            for query in args.wikimedia_query:
                for document in search_wikimedia(query, args.limit, args.language):
                    stream.write(json.dumps(document, ensure_ascii=False, sort_keys=True) + "\n")
                    total += 1
            for url in args.url:
                document = fetch_approved_page(url, allowlist, args.delay_seconds)
                stream.write(json.dumps(document, ensure_ascii=False, sort_keys=True) + "\n")
                total += 1
        print(json.dumps({"documentsWritten": total, "output": str(output), "licenceReviewRequired": True}, indent=2))
        return 0
    except (OSError, UnicodeError, ValueError, urllib.error.URLError, json.JSONDecodeError) as exc:
        print(f"connector failed: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
