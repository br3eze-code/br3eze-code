# AgentOS knowledge foundation

This package establishes a domain-neutral, provenance-first ingestion boundary. It prepares local, authorized source files for later indexing and review. It is not a crawler, embedding service, vector database, multimodal foundation model, or training system.

## Supported formats
- Text/developer data: TXT, Markdown, RST, HTML, XML, JSON, JSONL, CSV, TSV, YAML, logs, SQL, and common source/config formats.
- PDFs: optional text extraction via pypdf; scanned PDFs need a separately configured OCR pipeline.
- Images: optional OCR via Pillow, pytesseract, and a system Tesseract installation. This extracts text only; it does not understand visual semantics, create captions, or produce image embeddings.
- Internet sources: use an approved fetch/export connector and stage resulting files locally. This version makes no network requests.

## Run
From repository root:

    python experiments/llm-js/knowledge/ingest.py --input-root ./data/authorized-source-export --output ./data/knowledge-build

Optional PDF support:

    python -m pip install pypdf

Optional image OCR (also install the Tesseract executable for your operating system):

    python -m pip install pillow pytesseract
    python experiments/llm-js/knowledge/ingest.py --input-root ./data/authorized-source-export --output ./data/knowledge-build --ocr

Run tests:

    python -m unittest discover -s experiments/llm-js/knowledge -p 'test_*.py'

## Output contract
Each JSONL document contains schema version, deterministic document identifier, source-file hash, normalized-content hash, relative source URI, media type, extraction modality, license status, timestamps, redaction counts, and pending human-review/privacy-review states. The manifest records totals and skipped-file reasons. Source hash is computed before redaction; content hash after redaction and normalization.

## Safety rules
1. No training by default. Ingestion does not grant rights to train on a source.
2. No automatic licence approval. Setting license status to APPROVED is an operator assertion, not legal verification. Default is REVIEW_REQUIRED.
3. No privacy guarantee. Credential/email/IPv4 redaction is only a baseline; rules are incomplete. Review output before sharing or training.
4. Raw documents are retrieval candidates, not supervised answers or diagnosis labels.
5. Files are read as data; source code and documents are never executed.
6. Output must be outside the input directory to prevent self-ingestion.
7. OCR is not image understanding; visual reasoning needs an explicit vision adapter.
8. Private records must stay within authorized tenant boundaries and must not leak into shared corpora.
9. Retrieved instructions are untrusted data and cannot override runtime policy or tool authorization.

## Next adapters
Wikimedia/API exports; approved web crawling and web archives; PDF layout/table extraction; OCR and vision-language descriptions; audio/video transcription; database/record connectors; chunking and embeddings; retrieval/index backends; reviewed SFT examples; and benchmark/evaluation pipelines.

All adapters remain outside the canonical AgentRuntime. AgentRuntime stays the sole orchestration and execution authority.
