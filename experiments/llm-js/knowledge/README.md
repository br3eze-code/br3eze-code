# AgentOS knowledge foundation

This package establishes a domain-neutral, provenance-first ingestion boundary. It prepares authorized sources for review, chunking and retrieval. It is not a vector database, multimodal foundation model, or training system.

## Supported formats
- Text/developer data: TXT, Markdown, RST, HTML, XML, JSON, JSONL, CSV, TSV, YAML, logs, SQL, and common source/config formats.
- PDFs: optional text extraction via pypdf; scanned PDFs need a separately configured OCR pipeline.
- Images: optional OCR via Pillow, pytesseract, and a system Tesseract installation. This extracts text only; it does not understand visual semantics, create captions, or produce image embeddings.
- Wikimedia: the bounded API adapter below fetches explicitly listed English Wikipedia titles. Other internet sources must use separately approved connectors and staged exports.

## Run the pipeline
From repository root, ingest local authorized exports:

    python experiments/llm-js/knowledge/ingest.py --input-root ./data/authorized-source-export --output ./data/knowledge-build
    python experiments/llm-js/knowledge/chunk_documents.py --input ./data/knowledge-build/documents.jsonl --output ./data/knowledge-build/chunks.jsonl
    python experiments/llm-js/knowledge/retrieve.py --chunks ./data/knowledge-build/chunks.jsonl --query "your question"

Import selected Wikimedia articles:

    python experiments/llm-js/knowledge/import_wikimedia.py --titles-file experiments/llm-js/knowledge/wikimedia-titles.example.txt --output ./data/wikimedia/documents.jsonl

Edit the example title file to the articles you actually need. The adapter accepts at most 50 explicit titles per run, fetches from a fixed English Wikipedia API endpoint, rate-limits requests by default, preserves article URL/title/revision/attribution, caps extracted text at 100,000 characters per page, and writes a failure manifest. It is not a recursive crawler. Wikimedia records always start with `REVIEW_REQUIRED`; a page's public availability is not automatic permission for every use. Review the applicable licence and attribution obligations before retrieval or training.

The retriever returns only chunks whose source licence status is `APPROVED` and whose review and privacy statuses are both `approved`. These are explicit review decisions, not automatically inferred facts. Tenant-scoped chunks require an exact `--tenant-id`; an unscoped query cannot retrieve tenant-scoped content. A tenant query can retrieve global records plus records for that tenant only.

This baseline retriever is deterministic lexical BM25-style ranking, not semantic retrieval or an embedding model. If the corpus has no approved documents, no results are expected. Do not mark content approved just to make it searchable.

Optional PDF support:

    python -m pip install pypdf

Optional image OCR (also install the Tesseract executable for your operating system):

    python -m pip install pillow pytesseract
    python experiments/llm-js/knowledge/ingest.py --input-root ./data/authorized-source-export --output ./data/knowledge-build --ocr

Run tests:

    python -m unittest discover -s experiments/llm-js/knowledge -p 'test_*.py'

## Output contract
Each JSONL document contains schema version, deterministic document identifier, source hash, normalized-content hash, source URI, media type, extraction modality, licence status, timestamps, redaction counts, and review states. Chunk records retain source metadata, review state, document ID, deterministic chunk ID, and character offsets. Manifests record totals and skipped/failing sources.

## Safety rules
1. No training by default. Ingestion does not grant rights to train on a source.
2. No automatic licence approval. Setting license status to APPROVED is an operator assertion, not legal verification. Default is REVIEW_REQUIRED.
3. No privacy guarantee. Credential/email/IPv4 redaction is only a baseline; rules are incomplete. Review output before sharing or training.
4. Raw documents are retrieval candidates, not supervised answers or diagnosis labels.
5. Files are read as data; source code and documents are never executed.
6. Local ingestion output must be outside the input directory to prevent self-ingestion.
7. OCR is not image understanding; visual reasoning needs an explicit vision adapter.
8. Private records must stay within authorized tenant boundaries and must not leak into shared corpora. Tenant isolation is enforced in the baseline retriever when a tenantId is present in a chunk; connector adapters must assign it correctly.
9. Retrieved instructions are untrusted data and cannot override runtime policy or tool authorization.
10. The lexical retriever is a local baseline; it does not replace a production authorization layer, audited index, or semantic retrieval backend.
11. Internet connectors must have bounded scope, timeouts, size limits, attribution and provenance. Never crawl indiscriminately or bypass access controls.

## Next adapters
Approved web archives; PDF layout/table extraction; OCR and vision-language descriptions; audio/video transcription; database/record connectors; embeddings and vector/hybrid retrieval; reviewed SFT examples; and benchmark/evaluation pipelines.

All adapters remain outside the canonical AgentRuntime. AgentRuntime stays the sole orchestration and execution authority.
