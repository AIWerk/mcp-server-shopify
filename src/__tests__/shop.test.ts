import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getShopInfo,
  listCollections,
  listLocations,
  listMetafields,
} from '../tools/shop.js';
import { clearTokenCache } from '../auth.js';

const ORIGINAL_FETCH = globalThis.fetch;

function setEnv() {
  process.env.SHOPIFY_STORE_DOMAIN = 'aiwerk-mcp-dev.myshopify.com';
  process.env.SHOPIFY_CLIENT_ID = 'test-client-id';
  process.env.SHOPIFY_CLIENT_SECRET = 'test-client-secret';
}
function clearEnv() {
  delete process.env.SHOPIFY_STORE_DOMAIN;
  delete process.env.SHOPIFY_CLIENT_ID;
  delete process.env.SHOPIFY_CLIENT_SECRET;
}
function jsonResponse(b: unknown, s = 200): Response {
  return new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
}
function tokenResponse(): Response {
  return jsonResponse({ access_token: 'tok-abc', scope: 'read_publications,read_locations,read_metaobjects', expires_in: 86399 });
}

describe('shop tools', () => {
  beforeEach(() => { setEnv(); clearTokenCache(); });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; clearEnv(); clearTokenCache(); });

  it('getShopInfo returns shop wrapper', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { shop: { id: 'gid://shopify/Shop/1', name: 'Test Shop' } } })) as unknown as typeof fetch;

    const r = await getShopInfo();
    expect(r.shop).toMatchObject({ name: 'Test Shop' });
  });

  it('listCollections passes query and reverse', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: {
        collections: {
          pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
          edges: [{ node: { id: 'gid://shopify/Collection/1', title: 'Sale' } }],
        },
      } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await listCollections({ query: 'sale', reverse: true });
    expect(r.items).toHaveLength(1);
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { query: string; reverse: boolean };
    };
    expect(body.variables.query).toBe('sale');
    expect(body.variables.reverse).toBe(true);
  });

  it('listLocations defaults exclude inactive/legacy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: {
        locations: {
          pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
          edges: [],
        },
      } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await listLocations({});
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { includeInactive: boolean; includeLegacy: boolean };
    };
    expect(body.variables.includeInactive).toBe(false);
    expect(body.variables.includeLegacy).toBe(false);
  });

  it('listMetafields uses node(id:) and HasMetafields fragment', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: {
        node: {
          id: 'gid://shopify/Product/1',
          metafields: {
            pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'next', startCursor: null },
            edges: [{ node: { id: 'gid://shopify/Metafield/1', namespace: 'custom', key: 'a', value: 'b', type: 'single_line_text_field' } }],
          },
        },
      } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await listMetafields({ ownerId: '1', ownerType: 'PRODUCT' });
    expect(r.items).toHaveLength(1);
    expect(r.truncated).toBe(true);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      query: string; variables: { ownerId: string };
    };
    expect(body.variables.ownerId).toBe('gid://shopify/Product/1');
    expect(body.query).toContain('on HasMetafields');
  });

  it('listMetafields surfaces error when node has no metafields', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { node: null } })) as unknown as typeof fetch;

    const r = await listMetafields({ ownerId: '1', ownerType: 'PRODUCT' });
    expect(r.error).toBeDefined();
    expect(r.items).toEqual([]);
  });
});
