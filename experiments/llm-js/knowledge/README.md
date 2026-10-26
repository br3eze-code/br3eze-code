# AgentOS knowledge foundation

This package establishes a domain-neutral, provenance-first ingestion boundary. It prepares authorized sources for review, chunking and retrieval. It is not a crawler, vector database, multimodal foundation model, or training system.

## Supported formats
- Text/developer data: TXT, Markdown, RST, HTML, XML, JSON, JSONL, CSV, TSV, YAML, logs, SQL, and common source/config formats.
- PDFs: optional text extraction via pypdf; scanned PDFs need a separately configured OCR pipeline.
- Images: optional OCR via Pillow, pytesseract, and a system Tesseract installation. This extracts text only; it does not understand visual semantics, create captions, or produce image embeddings.
- Internet sources: use an approved fetch/export connector and stage resulting files locally. Ingestion itself makes no network requests.

## Run the pipeline
From repository root:

    python experiments/llm-js/knowledge/ingest.py --input-root ./data/authorized-source-export --output ./data/knowledge-build
    python experiments/llm-js/knowledge/chunk_documents.py --input ./data/knowledge-build/documents.jsonl --output ./data/knowledge-build/chunks.jsonl
    python experiments/llm-js/knowledge/retrieve.py --chunks ./data/knowledge-build/chunks.jsonl --query "your question"

The retriever deliberately returns only chunks whose source licence status is `APPROVED` and whose review and privacy statuses are both `approved`. These are explicit review decisions, not automatically inferred facts. Tenant-scoped chunks require an exact `--tenant-id`; an unscoped query cannot retrieve tenant-scoped content. A tenant query can retrieve global records plus records for that tenant only.

This baseline retriever is deterministic lexical BM25-style ranking, not semantic retrieval or an embedding model. If the corpus has no approved documents, no results are expected. Do not mark content approved just to make it searchable.

Optional PDF support:

    python -m pip install pypdf

Optional image OCR (also install the Tesseract executable for your operating system):

    python -m pip install pillow pytesseract
    python experiments/llm-js/knowledge/ingest.py --input-root ./data/authorized-source-export --output ./data/knowledge-build --ocr

Run tests:

    python -m unittest discover -s experiments/llm-js/knowledge -p 'test_*.py'

## Output contract
Each JSONL document contains schema version, deterministic document identifier, source-file hash, normalized-content hash, relative source URI, media type, extraction modality, licence status, timestamps, redaction counts, and pending human-review/privacy-review states. Chunk records retain source metadata, review state, document ID, deterministic chunk ID, and character offsets. The manifest records totals and skipped-file reasons. Source hash is computed before redaction; content hash after redaction and normalization.

## Safety rules
1. No training by default. Ingestion does not grant rights to train on a source.
2. No automatic licence approval. Setting license status to APPROVED is an operator assertion, not legal verification. Default is REVIEW_REQUIRED.
3. No privacy guarantee. Credential/email/IPv4 redaction is only a baseline; rules are incomplete. Review output before sharing or training.
4. Raw documents are retrieval candidates, not supervised answers or diagnosis labels.
5. Files are read as data; source code and documents are never executed.
6. Output must be outside the input directory to prevent self-ingestion.
7. OCR is not image understanding; visual reasoning needs an explicit vision adapter.
8. Private records must stay within authorized tenant boundaries and must not leak into shared corpora. Tenant isolation is enforced in the baseline retriever when a tenantId is present in a chunk; connector adapters must assign it correctly.
9. Retrieved instructions are untrusted data and cannot override runtime policy or tool authorization.
10. The lexical retriever is a local baseline; it does not replace a production authorization layer, audited index, or semantic retrieval backend.

## Next adapters
Wikimedia/API exports; approved web crawling and web archives; PDF layout/table extraction; OCR and vision-language descriptions; audio/video transcription; database/record connectors; embeddings and vector/hybrid retrieval; reviewed SFT examples; and benchmark/evaluation pipelines.

All adapters remain outside the canonical AgentRuntime. AgentRuntime stays the sole orchestration and execution authority.


## Connector and persistent-index layer

The connector layer is opt-in and stages records as **pending**; it does not certify licensing or privacy.

### Wikimedia search

```bash
python experiments/llm-js/knowledge/source_connectors.py \
  --wikimedia-query "distributed systems" \
  --wikimedia-query "computer networking" \
  --limit 5 \
  --output ./data/knowledge-build/connector-documents.jsonl
```

Wikipedia content commonly carries Creative Commons Attribution-ShareAlike terms, but verify the applicable page revision, attribution and licence before approving reuse. The connector records a licence hint and keeps `licenseStatus=REVIEW_REQUIRED`.

### Explicitly allowlisted HTTPS pages

```bash
python experiments/llm-js/knowledge/source_connectors.py \
  --url https://docs.example.org/approved-guide \
  --allow-host docs.example.org \
  --output ./data/knowledge-build/web-documents.jsonl
```

Use only sites you are authorized to access and process. The web connector requires HTTPS, an exact hostname allowlist, public DNS addresses, a robots.txt check, response size limits, a timeout, and same-allowlist redirects. It does not crawl arbitrary link graphs. It extracts text only and does not bypass authentication, paywalls, or access controls. The operator remains responsible for authorization, terms and licence review.

### Build chunks and an on-disk lexical index

```bash
python experiments/llm-js/knowledge/chunk_documents.py \
  --input ./data/knowledge-build/documents.jsonl \
  --output ./data/knowledge-build/chunks.jsonl
python experiments/llm-js/knowledge/build_index.py \
  --chunks ./data/knowledge-build/chunks.jsonl \
  --database ./data/knowledge-build/knowledge.sqlite
python experiments/llm-js/knowledge/search_index.py \
  --database ./data/knowledge-build/knowledge.sqlite \
  --query "distributed consensus" --limit 5
```

Run the chunker on a JSONL file containing normalized documents (combine connector output with the reviewed ingestion output first, if needed). The SQLite FTS5 index is a deterministic lexical baseline, not semantic/vector retrieval. It indexes only records whose licence, content review and privacy status are all explicitly approved. A tenant-scoped query can see global approved records plus that tenant's approved records; an unscoped query cannot see tenant-private chunks.

### Data and training boundary

Connector output is not automatically approved for retrieval or training. Preserve source attribution and hashes, review licences and privacy, deduplicate, then chunk and index approved records. Retrieval corpora, supervised examples, evaluation sets and model-training corpora must be versioned separately. No model training occurs in these commands.
