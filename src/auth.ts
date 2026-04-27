// OAuth client_credentials grant for Shopify Dev Dashboard apps.
// Endpoint: POST https://{shop}.myshopify.com/admin/oauth/access_token
// Tokens are valid for 24h; we refresh proactively before expiry.

export class ShopifyAuthError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'ShopifyAuthError';
  }
}

export interface ShopifyCredentials {
  storeDomain: string;
  clientId: string;
  clientSecret: string;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

let cached: CachedToken | null = null;
let inflight: Promise<CachedToken> | null = null;

export function getCredentials(): ShopifyCredentials {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  const missing: string[] = [];
  if (!storeDomain) missing.push('SHOPIFY_STORE_DOMAIN');
  if (!clientId) missing.push('SHOPIFY_CLIENT_ID');
  if (!clientSecret) missing.push('SHOPIFY_CLIENT_SECRET');
  if (missing.length > 0) {
    throw new ShopifyAuthError(
      401,
      `Missing required env var(s): ${missing.join(', ')}. See README for setup.`
    );
  }

  return {
    storeDomain: normalizeStoreDomain(storeDomain!),
    clientId: clientId!,
    clientSecret: clientSecret!,
  };
}

export function normalizeStoreDomain(raw: string): string {
  if (typeof raw !== 'string') {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must be a string');
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must not be empty');
  }

  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw new ShopifyAuthError(
      400,
      `SHOPIFY_STORE_DOMAIN is not a valid URL: ${truncateForError(raw)}`
    );
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must use http(s) scheme');
  }
  if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must not include a path');
  }
  if (parsed.search) {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must not include a query string');
  }
  if (parsed.hash) {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must not include a fragment');
  }
  if (parsed.username || parsed.password) {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must not include userinfo');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must not specify a non-default port');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname.length === 0) {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must include a hostname');
  }
  if (!hostname.endsWith('.myshopify.com')) {
    throw new ShopifyAuthError(
      400,
      'SHOPIFY_STORE_DOMAIN must be a *.myshopify.com hostname'
    );
  }
  if (hostname === '.myshopify.com' || hostname === 'myshopify.com') {
    throw new ShopifyAuthError(400, 'SHOPIFY_STORE_DOMAIN must include a shop name');
  }

  return hostname;
}

function truncateForError(s: string): string {
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt - now > REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }
  if (inflight) {
    const t = await inflight;
    return t.accessToken;
  }
  inflight = fetchToken();
  try {
    const t = await inflight;
    cached = t;
    return t.accessToken;
  } finally {
    inflight = null;
  }
}

export function clearTokenCache(): void {
  cached = null;
  inflight = null;
}

async function fetchToken(): Promise<CachedToken> {
  const { storeDomain, clientId, clientSecret } = getCredentials();
  const url = `https://${storeDomain}/admin/oauth/access_token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ShopifyAuthError(0, `Token request failed: ${detail}`);
  }

  const text = await response.text();

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; error_description?: string };
      const msg = parsed.error_description ?? parsed.error;
      if (msg) detail = `${response.status} ${response.statusText} - ${msg}`;
    } catch {
      // ignore parse errors
    }
    throw new ShopifyAuthError(response.status, `Token request rejected: ${detail}`);
  }

  let parsed: { access_token?: string; scope?: string; expires_in?: number };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ShopifyAuthError(response.status, 'Token response was not valid JSON');
  }

  if (!parsed.access_token || typeof parsed.access_token !== 'string') {
    throw new ShopifyAuthError(response.status, 'Token response missing access_token');
  }

  const expiresInSec = typeof parsed.expires_in === 'number' && parsed.expires_in > 0
    ? parsed.expires_in
    : 86_399;

  return {
    accessToken: parsed.access_token,
    scope: parsed.scope ?? '',
    expiresAt: Date.now() + expiresInSec * 1000,
  };
}
