import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ShopifyAuthError,
  clearTokenCache,
  getAccessToken,
  getCredentials,
  normalizeStoreDomain,
} from '../auth.js';

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

describe('normalizeStoreDomain', () => {
  it('passes a bare myshopify.com domain through', () => {
    expect(normalizeStoreDomain('foo.myshopify.com')).toBe('foo.myshopify.com');
  });
  it('strips https scheme and trailing slash, lowercases', () => {
    expect(normalizeStoreDomain('https://Foo.myshopify.com/')).toBe('foo.myshopify.com');
  });
  it('strips http scheme', () => {
    expect(normalizeStoreDomain('http://shop.myshopify.com')).toBe('shop.myshopify.com');
  });

  it('rejects non-myshopify hostnames', () => {
    expect(() => normalizeStoreDomain('evil.example.com')).toThrow(/myshopify\.com/);
    expect(() => normalizeStoreDomain('https://evil.example.com')).toThrow(/myshopify\.com/);
  });
  it('rejects suffix tricks (foo.myshopify.com.evil.com)', () => {
    expect(() => normalizeStoreDomain('foo.myshopify.com.evil.com')).toThrow(/myshopify\.com/);
  });
  it('rejects names that match without a dot (evilmyshopify.com)', () => {
    expect(() => normalizeStoreDomain('evilmyshopify.com')).toThrow(/myshopify\.com/);
  });
  it('rejects bare myshopify.com without a shop', () => {
    expect(() => normalizeStoreDomain('myshopify.com')).toThrow(/myshopify\.com/);
  });
  it('rejects values that include a path', () => {
    expect(() => normalizeStoreDomain('https://foo.myshopify.com/admin')).toThrow(/path/);
    expect(() => normalizeStoreDomain('foo.myshopify.com/admin')).toThrow(/path/);
  });
  it('rejects values that include a query string', () => {
    expect(() => normalizeStoreDomain('https://foo.myshopify.com/?x=1')).toThrow(/query/);
  });
  it('rejects values that include a fragment', () => {
    expect(() => normalizeStoreDomain('https://foo.myshopify.com/#x')).toThrow(/fragment/);
  });
  it('rejects values that include userinfo', () => {
    expect(() => normalizeStoreDomain('https://user:pw@foo.myshopify.com')).toThrow(/userinfo/);
  });
  it('rejects values with a non-default port', () => {
    expect(() => normalizeStoreDomain('https://foo.myshopify.com:8080')).toThrow(/port/);
  });
  it('rejects empty input', () => {
    expect(() => normalizeStoreDomain('')).toThrow(/empty/);
    expect(() => normalizeStoreDomain('   ')).toThrow(/empty/);
  });
  it('rejects malformed URLs', () => {
    expect(() => normalizeStoreDomain('https://')).toThrow();
  });
});

describe('getCredentials', () => {
  beforeEach(() => clearEnv());
  afterEach(() => clearEnv());

  it('throws with all missing var names listed', () => {
    expect(() => getCredentials()).toThrow(/SHOPIFY_STORE_DOMAIN.*SHOPIFY_CLIENT_ID.*SHOPIFY_CLIENT_SECRET/);
  });

  it('returns normalized creds when set', () => {
    setEnv();
    const c = getCredentials();
    expect(c.storeDomain).toBe('aiwerk-mcp-dev.myshopify.com');
    expect(c.clientId).toBe('test-client-id');
    expect(c.clientSecret).toBe('test-client-secret');
  });
});

describe('getAccessToken', () => {
  beforeEach(() => {
    setEnv();
    clearTokenCache();
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    clearEnv();
    clearTokenCache();
  });

  it('exchanges credentials and caches the token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ access_token: 'tok-abc', scope: 'read_products', expires_in: 86399 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const t1 = await getAccessToken();
    const t2 = await getAccessToken();
    expect(t1).toBe('tok-abc');
    expect(t2).toBe('tok-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://aiwerk-mcp-dev.myshopify.com/admin/oauth/access_token');
    expect((init as RequestInit).method).toBe('POST');
    const body = (init as RequestInit).body as URLSearchParams;
    expect(body.toString()).toContain('grant_type=client_credentials');
    expect(body.toString()).toContain('client_id=test-client-id');
    expect(body.toString()).toContain('client_secret=test-client-secret');
  });

  it('throws ShopifyAuthError on 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 })
    ) as unknown as typeof fetch;

    await expect(getAccessToken()).rejects.toBeInstanceOf(ShopifyAuthError);
  });

  it('throws when access_token is missing in response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ scope: 'read_products' }), { status: 200 })
    ) as unknown as typeof fetch;

    await expect(getAccessToken()).rejects.toThrow(/access_token/);
  });
});
