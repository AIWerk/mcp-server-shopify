# Security policy

## Reporting a vulnerability

Email `kontakt@aiwerk.ch` with the details. We aim to respond within 72 hours and ship a patched npm release within seven days for confirmed issues. Please do not open a public GitHub issue for security reports.

## Credential handling

This server requires three pieces of authentication material:

- `SHOPIFY_STORE_DOMAIN` — public, fine to commit to config files.
- `SHOPIFY_CLIENT_ID` — semi-public per OAuth public-client semantics, but treat it as an identifier you do not want to leak in logs.
- `SHOPIFY_CLIENT_SECRET` — true secret. Never commit, never log, never pass on the command line.

The server reads all three from environment variables only. CLI arguments for credentials are intentionally not supported, to keep them out of process lists, shell history, and `ps -ef` dumps.

The OAuth access token derived from the client credentials is held in memory only. It is never written to disk, never logged, and is automatically rotated before its 24-hour expiry.

## Scope minimization

The README lists the 14 scopes needed for the full v0.1 tool surface. If your use case only needs a subset (e.g. read-only orders), trim the scope list when you create the Dev Dashboard app version. The server gracefully degrades: a tool whose backing scope is missing will return a structured error rather than crash.

## Protected customer data

Shopify gates access to customer-bearing objects (`Customer`, `DraftOrder`, and `customer { ... }` selections inside `Order`) behind a separate compliance review at https://shopify.dev/docs/apps/launch/protected-customer-data. Without approval, the affected tools will return a clean `ACCESS_DENIED` GraphQL error rather than partial data. Product, inventory, collection, location, metafield, and shop-info tools are unaffected.

## Rate-limit and cost awareness

The server respects the Shopify GraphQL cost-based rate limit. Heavy queries that risk throttling are paginated by default. The server does not retry transient 5xx responses indefinitely; it surfaces the failure to the AI client after a single retry with backoff.

## Pinning

The Shopify Admin GraphQL API version is pinned per release of this package (currently `2026-04`). We bump the pin in a minor release after each Shopify quarterly cycle, after we have re-validated the test suite against the new version.
