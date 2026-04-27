# Changelog

All notable changes to `@aiwerk/mcp-server-shopify` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed (Axel review round 1, 2026-04-27)

- **Critical:** `normalizeStoreDomain` now parses with `new URL()` and enforces a bare `*.myshopify.com` hostname. Rejects path, query string, fragment, userinfo, non-default port, suffix tricks (`foo.myshopify.com.evil.com`), name tricks (`evilmyshopify.com`), and bare `myshopify.com`. Closes a token-exfiltration vector where a malicious `SHOPIFY_STORE_DOMAIN` env var could send the client secret to an attacker-controlled host.
- **Major:** GraphQL 401/403 now busts the in-memory token cache and retries once with a fresh token before throwing `AUTH`. Recovers from early-revoked tokens and scope changes without a server restart.
- **Major:** `list_metafields` now returns `totalCount: 'unknown'`, completing the honest-pagination contract.
- **Major:** README drift — `metaobjects` → `metafields` in description, scopes list trimmed from 14 to the 12 actually required (removed `read_metaobjects`/`write_metaobjects`), local-dev snippet cleaned, removed unsubstantiated integration-test claim.
- **Medium:** `shopify_create_draft_order` line items now Zod-enforce the `variantId OR (title + originalUnitPrice)` rule with a `.refine()` rather than relying on Shopify's `userErrors`.
- **Medium:** Build now uses `tsconfig.build.json` which excludes `__tests__/` from the emitted output. The tarball no longer ships compiled test files. New `npm run typecheck` script type-checks everything (including tests) without emitting; `prepublishOnly` now runs typecheck → build → test.

### Added

- 28 tools across 6 modules:
  - **Products (8)**: list / get / search + create / update / archive
    (soft-confirm) + add_tag / remove_tag.
  - **Orders (6)**: list / get / search + mark_paid / cancel
    (soft-confirm, async job) / add_note (append-by-default mode).
  - **Customers (6)**: list / get / search + create / update /
    add_note. Requires Shopify protected-customer-data approval.
  - **Inventory (2)**: get_inventory_level (5 quantity buckets) +
    adjust_inventory_level (with @idempotent + changeFromQuantity).
  - **Draft orders (2)**: create + complete (soft-confirm).
    Requires protected-customer-data approval.
  - **Shop (4)**: get_shop_info, list_collections, list_locations,
    list_metafields (any HasMetafields owner type).
- Modern OAuth client_credentials grant against
  `/admin/oauth/access_token`. In-memory token cache with a 5-minute
  refresh margin and singleflight. Three env vars (no CLI args for
  secrets).
- GraphQL Admin API client pinned to `2026-04`. Single retry on 429
  (Retry-After honored), 5xx, network failure, and GraphQL THROTTLED
  with cost-aware delay derived from `throttleStatus.restoreRate`.
- Honest pagination: every list/search tool returns `pageInfo` plus
  `totalCount: 'unknown'`. Nested children (variants, images, line
  items) are capped at 250 with explicit `truncated: true` markers
  when more remain.
- 60 unit tests covering all modules; live smoke validation against
  the AIWerk dev store on 2026-04-27.
- Initial scaffold: package skeleton, TypeScript config, MIT license,
  README, SECURITY policy.

### Notes

- Customer-bearing objects (`Customer`, `DraftOrder`, `customer { ... }`
  inside `Order`) require Shopify's protected-customer-data approval.
  Without approval, those tools return a clean `ACCESS_DENIED` error.
  Product, inventory, collection, location, metafield, and shop-info
  tools are unaffected.
