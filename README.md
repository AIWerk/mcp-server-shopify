# @aiwerk/mcp-server-shopify

Shopify Admin GraphQL API MCP server. Lets an AI agent read and write to a Shopify store: products, orders, customers, inventory, draft orders, collections, locations, metafields.

Built and signed by [AIWerk](https://aiwerkmcp.com). MIT licensed.

## Status

`v0.1.0` — under active development. Tool surface and credential flow may change before `v1.0`.

## Install

```bash
npx -y @aiwerk/mcp-server-shopify
```

## Authentication

This server uses the **modern OAuth client_credentials grant** (Shopify Dev Dashboard apps). Legacy `shpat_*` custom-app tokens are not supported.

Three environment variables:

| Env var | What |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | Your store domain, e.g. `your-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Client ID from your Shopify Dev Dashboard app |
| `SHOPIFY_CLIENT_SECRET` | Client Secret from your Shopify Dev Dashboard app |

The server automatically exchanges the client credentials for an Admin API access token and refreshes the token before its 24h expiry. No manual token rotation.

### Creating the Dev Dashboard app

1. Sign in to [Shopify Partner Dashboard](https://partners.shopify.com), then open the [Dev Dashboard](https://dev.shopify.com/dashboard/).
2. **Apps → Create app → Start from Dev Dashboard**. Name it (e.g. `my-mcp-app`).
3. **Versions** tab → set the scopes you need (see below) → **Release**.
4. **Home** tab → **Install app** → choose your store → **Install**.
5. **Settings** tab → copy **Client ID** and **Client Secret**.

### Scopes

The 12 scopes below cover the full v0.1 tool surface. Trim to a smaller set if you want a more restricted token (e.g. read-only orders).

```
read_products, write_products,
read_customers, write_customers,
read_orders, write_orders,
read_draft_orders, write_draft_orders,
read_inventory, write_inventory,
read_locations,
read_publications
```

## Tools

`v0.1` ships 28 tools across the Shopify Admin GraphQL API. See `src/tools/` for the implementation; tool names are shown in `tools/list` after the server starts.

### Protected customer data

Shopify gates access to customer-bearing objects (`Customer`, `DraftOrder`, plus `customer { ... }` selections inside `Order`) behind a separate approval. Apps not approved for protected customer data will see this error from the affected tools:

```
GraphQL error: This app is not approved to access the Customer object.
See https://shopify.dev/docs/apps/launch/protected-customer-data
```

The server returns this error verbatim to the AI client. Apply for protected-data approval at the link above if you need:

- `shopify_list_customers`, `_get_customer`, `_search_customers`, `_create_customer`, `_update_customer`, `_add_customer_note`
- `shopify_create_draft_order`, `_complete_draft_order`
- `shopify_get_order`, `_list_orders`, `_search_orders`, `_mark_order_paid`, `_cancel_order`, `_add_order_note` (these may also be affected when the response includes customer fields)

Product, inventory, location, collection, metafield, and shop-info tools are unaffected.

## API version

The server pins the Shopify GraphQL Admin API to `2026-04`. Bumped quarterly per the Shopify release schedule.

## Local development

```bash
npm install
npm run build

export SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
export SHOPIFY_CLIENT_ID=YOUR_CLIENT_ID
export SHOPIFY_CLIENT_SECRET=YOUR_CLIENT_SECRET
node dist/src/server.js
```

Pull the secrets from your preferred secret store however you like. For example, with `pass(1)`:

```bash
SHOPIFY_CLIENT_ID=$(pass show aiwerk/shopify-dev-client-id)
SHOPIFY_CLIENT_SECRET=$(pass show aiwerk/shopify-dev-client-secret)
export SHOPIFY_CLIENT_ID SHOPIFY_CLIENT_SECRET
```

## Tests

```bash
npm test
```

Unit tests use mocked GraphQL responses and run with no external dependencies. There is no live integration harness in this repo — for now we smoke-test against an internal AIWerk dev store before publish.

## Security

See [SECURITY.md](SECURITY.md) for credential handling, scope minimization, and disclosure policy.

## License

MIT, see [LICENSE](LICENSE).
