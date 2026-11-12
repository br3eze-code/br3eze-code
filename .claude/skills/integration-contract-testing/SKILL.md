---
name: integration-contract-testing
description: Design and verify stable contracts for adapters and external integrations, including auth, billing, storage, network services, and model providers. Use when adding or changing an external provider or adapter.
---

# Integration Contract Testing

1. Locate the existing interface, adapter, registry, provider configuration, and call sites before adding a new integration.
2. Define contract behavior for success, invalid input, authentication failure, timeout, rate limit, malformed response, retries, and cancellation where applicable.
3. Keep provider-specific SDKs, response shapes, and configuration behind the existing adapter boundary.
4. Use deterministic fakes or mocks for unit tests; use live sandbox integration tests only when credentials, environment, and explicit authorization are available.
5. Verify timeouts, bounded retries, idempotency for writes, safe error mapping, and secret redaction.
6. Do not report a live integration as verified based solely on mocked tests.
7. Run contract tests and the relevant architecture gate.
8. Document provider setup, required environment variable names (never values), operational limitations, and how to replace or disable the provider.
