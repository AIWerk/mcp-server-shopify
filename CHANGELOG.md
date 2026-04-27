# Changelog

All notable changes to `@aiwerk/mcp-server-shopify` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
