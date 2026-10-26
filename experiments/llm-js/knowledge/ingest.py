#!/usr/bin/env python3
"""Domain-neutral, provenance-first knowledge ingestion for AgentOS."""
from __future__ import annotations
import argparse, csv, hashlib, html, json, re, sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCHEMA_VERSION = "1.0"
TEXT_EXTENSIONS = {".txt",".md",".rst",".html",".htm",".json",".jsonl",".csv",".xml",".yaml",".yml",".log",".tsv",".sql",".js",".ts",".py",".java",".go",".rs",".sh",".rsc",".cfg",".conf"}
IMAGE_EXTENSIONS = {".png",".jpg",".jpeg",".webp",".tif",".tiff",".bmp"}
SKIP_DIRS = {".git","node_modules","vendor","dist","build",".venv","venv","__pycache__",".next",".cache","coverage"}
SKIP_NAMES = {".env",".env.local","id_rsa","id_ed25519","credentials.json"}
SECRET_PATTERNS = [
 re.compile(r'(?i)(\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\b\s*[:=]\s*)(["\']?)[^\s,"\'>}]+'),
 re.compile(r'(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+'),
 re.compile(r'(?i)(\bauthorization\b\s*:\s*)(?:basic|bearer)\s+[^\s]+'),
]
EMAIL_RE=re.compile(r'\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b',re.I)
IPV4_RE=re.compile(r'\b(?:\d{1,3}\.){3}\d{1,3}\b')
HTML_TAG_RE=re.compile(r"<[^>]+>")

def sha256(data: bytes) -> str: return hashlib.sha256(data).hexdigest()

def redact(text: str) -> tuple[str,dict[str,int]]:
 counts={"credentialPatterns":0,"emails":0,"ipv4Addresses":0}; value=text
 for pattern in SECRET_PATTERNS:
  value,n=pattern.subn(lambda m: m.group(1)+"[REDACTED]",value); counts["credentialPatterns"]+=n
 value,counts["emails"]=EMAIL_RE.subn("[REDACTED_EMAIL]",value)
 value,counts["ipv4Addresses"]=IPV4_RE.subn("[REDACTED_IP]",value)
 return value,counts

def html_to_text(raw: str) -> str:
 raw=re.sub(r"(?is)<(script|style|noscript)\b.*?</\1\s*>"," ",raw)
 raw=re.sub(r"(?i)<br\s*/?>|</(?:p|div|li|h[1-6]|tr|section|article)>","\n",raw)
 return html.unescape(HTML_TAG_RE.sub(" ",raw))

def extract(path: Path, enable_ocr: bool) -> tuple[str,str,dict[str,Any]]:
 ext=path.suffix.lower(); metadata:dict[str,Any]={}
 if ext in TEXT_EXTENSIONS:
  raw=path.read_text(encoding="utf-8",errors="replace")
  if ext in {".html",".htm",".xml"}: raw=html_to_text(raw)
  elif ext in {".csv",".tsv"}:
   rows=list(csv.reader(raw.splitlines(),delimiter="\t" if ext==".tsv" else ","))
   raw="\n".join(" | ".join(c.strip() for c in row) for row in rows)
  elif ext==".json":
   try: raw=json.dumps(json.loads(raw),ensure_ascii=False,indent=2)
   except json.JSONDecodeError: pass
  elif ext==".jsonl":
   normalized=[]
   for line in raw.splitlines():
    if not line.strip(): continue
    try: normalized.append(json.dumps(json.loads(line),ensure_ascii=False,sort_keys=True))
    except json.JSONDecodeError: normalized.append(line)
   raw="\n".join(normalized)
  return raw,"text",metadata
 if ext==".pdf":
  try: from pypdf import PdfReader
  except ImportError as exc: raise RuntimeError("PDF support requires optional dependency pypdf.") from exc
  reader=PdfReader(str(path)); metadata["pageCount"]=len(reader.pages)
  return "\n\n".join(f"[page {i}]\n{page.extract_text() or ''}" for i,page in enumerate(reader.pages,1)),"pdf-text",metadata
 if ext in IMAGE_EXTENSIONS:
  if not enable_ocr: raise RuntimeError("image skipped: OCR disabled; use --ocr only for authorized images")
  try:
   import pytesseract
   from PIL import Image
  except ImportError as exc: raise RuntimeError("Image OCR requires optional Pillow and pytesseract, plus Tesseract installed on the system.") from exc
  with Image.open(path) as image:
   metadata["imageSize"]=list(image.size); raw=pytesseract.image_to_string(image)
  return raw,"image-ocr-text",metadata
 raise RuntimeError(f"unsupported file type: {ext or '[no extension]'}")

def iter_files(root: Path) -> Iterable[Path]:
 for path in sorted(root.rglob("*")):
  if not path.is_file(): continue
  parts=path.relative_to(root).parts
  if any(p in SKIP_DIRS or p.startswith(".git") for p in parts[:-1]): continue
  if path.name.lower() in SKIP_NAMES or path.name.lower().startswith(".env"): continue
  if path.suffix.lower() in TEXT_EXTENSIONS|IMAGE_EXTENSIONS|{".pdf"}: yield path

def build(args: argparse.Namespace) -> dict[str,Any]:
 root=Path(args.input_root).resolve(); output=Path(args.output).resolve()
 if not root.is_dir(): raise ValueError(f"input root is not a directory: {root}")
 if output==root or root in output.parents: raise ValueError("output must be outside input root to prevent self-ingestion")
 output.mkdir(parents=True,exist_ok=True); out_file=output/"documents.jsonl"
 seen:set[str]=set(); rows=[]; skipped=[]; totals={"filesSeen":0,"documentsWritten":0,"duplicates":0,"redactions":0}
 for path in iter_files(root):
  totals["filesSeen"]+=1; relative=path.relative_to(root).as_posix()
  try:
   if path.stat().st_size>args.max_file_bytes: raise RuntimeError(f"file exceeds --max-file-bytes ({args.max_file_bytes})")
   raw,modality,extra=extract(path,args.ocr); clean,counts=redact(raw)
   clean="\n".join(line.rstrip() for line in clean.splitlines()).strip()
   if not clean: raise RuntimeError("no extractable text; image embeddings/captions are not generated")
   digest=sha256(clean.encode("utf-8"))
   if digest in seen: totals["duplicates"]+=1; continue
   seen.add(digest); totals["redactions"]+=sum(counts.values())
   rows.append({"schemaVersion":SCHEMA_VERSION,"documentId":sha256((relative+":"+digest).encode())[:24],
    "source":{"uri":relative,"sourceType":"local-file","mediaType":path.suffix.lower().lstrip("."),
     "contentHash":"sha256:"+sha256(path.read_bytes()),"licenseStatus":args.license_status,
     "retrievedAt":datetime.now(timezone.utc).isoformat()},
    "content":{"modality":modality,"text":clean,"contentHash":"sha256:"+digest,**({"extraction":extra} if extra else {})},
    "quality":{"reviewStatus":"pending","privacyStatus":"needs-human-review","redactions":counts}})
  except (OSError,UnicodeError,RuntimeError,ValueError) as exc: skipped.append({"source":relative,"reason":str(exc)})
 with out_file.open("w",encoding="utf-8",newline="\n") as stream:
  for row in rows: stream.write(json.dumps(row,ensure_ascii=False,sort_keys=True)+"\n")
 totals["documentsWritten"]=len(rows)
 manifest={"schemaVersion":SCHEMA_VERSION,"createdAt":datetime.now(timezone.utc).isoformat(),"inputRootLabel":root.name,
  "outputFile":out_file.name,"licenseStatusDefault":args.license_status,
  "policy":{"noNetworkFetching":True,"noModelTraining":True,"noSourceFilesUploaded":True,
   "redactionIsNotSufficientForPrivacyApproval":True,"documentsRequireLicenseAndHumanReview":True},
  "totals":totals,"skipped":skipped}
 (output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
 return manifest

def main(argv:list[str]|None=None)->int:
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--input-root",required=True,help="local directory containing authorized source files")
 parser.add_argument("--output",required=True,help="output directory outside input-root")
 parser.add_argument("--license-status",choices=("REVIEW_REQUIRED","APPROVED","RESTRICTED"),default="REVIEW_REQUIRED")
 parser.add_argument("--max-file-bytes",type=int,default=20_000_000)
 parser.add_argument("--ocr",action="store_true",help="enable optional OCR for images")
 args=parser.parse_args(argv)
 if args.max_file_bytes<1: parser.error("--max-file-bytes must be positive")
 try: manifest=build(args)
 except (OSError,ValueError) as exc: print(f"ingestion failed: {exc}",file=sys.stderr); return 2
 print(json.dumps({"totals":manifest["totals"],"skipped":len(manifest["skipped"])},indent=2)); return 0
if __name__=="__main__": raise SystemExit(main())
