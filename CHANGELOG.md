# Changelog

## 0.1.0 (2026-09-26)

- First release: a read-only MCP server over stdio with five tools (`search_products`, `get_product`, `search_faqs`, `get_policy`, `answer_sources`), three resources and a `customer_reply` prompt.
- Fictional sample data for Sunleaf Tea Co.: 20 products, 25 FAQs and 4 policies.
- Offline keyword search with field weights, and a threshold that answers "not covered" instead of guessing.
- `SUNLEAF_DATA_DIR` to point the server at your own files, with a clear error for malformed data.
- Unit tests and an in-process client/server integration test (vitest).
