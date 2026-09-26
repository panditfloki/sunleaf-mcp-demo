# Changelog

## Unreleased

- FAQs can name the policy that governs them with an optional `policy` field. `answer_sources` returns that policy's scope beside the FAQ, so a question such as "Do you sell wholesale to cafes in Canada?" keeps the rule that wholesale orders ship inside India only, even when only the FAQ matches. The bundled shipping, returns and wholesale FAQs are linked.
- The data loader rejects an FAQ that names a policy with no file, instead of dropping that policy's rules silently.
- The wholesale FAQ now says who can apply in the same terms as the wholesale policy (hotels included, India only).

## 0.1.0 (2026-09-26)

- First release: a read-only MCP server over stdio with five tools (`search_products`, `get_product`, `search_faqs`, `get_policy`, `answer_sources`), two resources, a policy resource template and a `customer_reply` prompt.
- Fictional sample data for Sunleaf Tea Co.: 20 products, 25 FAQs and 4 policies.
- Offline keyword search with field weights. `answer_sources` marks passages as answers or partial matches, keeps each policy's scope section beside any other section it returns, and says so when nothing matches.
- Ids ignore case and surrounding spaces, in validation and lookup alike.
- `SUNLEAF_DATA_DIR` to point the server at your own files, with a clear error for malformed data.
- Unit tests and an in-process client/server integration test (vitest).
