import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShopifyApiError, SHOPIFY_API_VERSION, shopifyGraphQL } from '../api.js';
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse(): Response {
  return jsonResponse({
    access_token: 'tok-abc',
    scope: 'read_products',
    expires_in: 86399,
  });
}

describe('shopifyGraphQL', () => {
  beforeEach(() => {
    setEnv();
    clearTokenCache();
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    clearEnv();
    clearTokenCache();
  });

  it('issues a request with X-Shopify-Access-Token to the pinned API version', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { shop: { name: 'Test' } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await shopifyGraphQL<{ shop: { name: string } }>(`{ shop { name } }`);
    expect(result.data.shop.name).toBe('Test');

    const [graphqlUrl, graphqlInit] = fetchMock.mock.calls[1];
    expect(graphqlUrl).toBe(
      `https://aiwerk-mcp-dev.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`
    );
    const headers = (graphqlInit as RequestInit).headers as Record<string, string>;
    expect(headers['X-Shopify-Access-Token']).toBe('tok-abc');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws AUTH error on 401', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('{}', { status: 401 })) as unknown as typeof fetch;

    await expect(shopifyGraphQL(`{ shop { name } }`)).rejects.toMatchObject({
      name: 'ShopifyApiError',
      code: 'AUTH',
      status: 401,
    });
  });

  it('retries once on 429 then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '0' } }))
      .mockResolvedValueOnce(jsonResponse({ data: { shop: { name: 'Retried' } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await shopifyGraphQL<{ shop: { name: string } }>(`{ shop { name } }`);
    expect(result.data.shop.name).toBe('Retried');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries on GraphQL THROTTLED then succeeds', async () => {
    const throttled = jsonResponse({
      errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
      extensions: {
        cost: {
          requestedQueryCost: 100,
          actualQueryCost: 0,
          throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 50, restoreRate: 1000 },
        },
      },
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(throttled)
      .mockResolvedValueOnce(jsonResponse({ data: { shop: { name: 'Recovered' } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await shopifyGraphQL<{ shop: { name: string } }>(`{ shop { name } }`);
    expect(result.data.shop.name).toBe('Recovered');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces non-throttle GraphQL errors', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        errors: [{ message: 'Field "bogus" does not exist' }],
      })) as unknown as typeof fetch;

    await expect(shopifyGraphQL(`{ bogus }`)).rejects.toMatchObject({
      code: 'GRAPHQL',
      message: expect.stringContaining('Field "bogus"'),
    });
  });

  it('retries on 5xx then surfaces HTTP error', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('boom', { status: 502 }))
      .mockResolvedValueOnce(new Response('boom', { status: 502 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(shopifyGraphQL(`{ shop { name } }`)).rejects.toMatchObject({
      code: 'HTTP',
      status: 502,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('exports SHOPIFY_API_VERSION pinned to 2026-04', () => {
    expect(SHOPIFY_API_VERSION).toBe('2026-04');
  });

  it('ShopifyApiError exposes code/status/details', () => {
    const e = new ShopifyApiError('GRAPHQL', 200, 'msg', [{ message: 'x' }]);
    expect(e.code).toBe('GRAPHQL');
    expect(e.status).toBe(200);
    expect(e.details).toEqual([{ message: 'x' }]);
  });
});
