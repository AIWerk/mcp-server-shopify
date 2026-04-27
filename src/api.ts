// Shopify Admin GraphQL API client.
// Endpoint: POST https://{shop}.myshopify.com/admin/api/{API_VERSION}/graphql.json
// Header:   X-Shopify-Access-Token: {token}
// We retry once on transient failures (429, 5xx, GraphQL THROTTLED).

import { clearTokenCache, getAccessToken, getCredentials } from './auth.js';

export const SHOPIFY_API_VERSION = '2026-04';
const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_BASE_DELAY_MS = 1000;

export type ShopifyErrorCode =
  | 'NETWORK'
  | 'AUTH'
  | 'THROTTLE'
  | 'GRAPHQL'
  | 'HTTP'
  | 'PARSE';

export class ShopifyApiError extends Error {
  constructor(
    public readonly code: ShopifyErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ShopifyApiError';
  }
}

export interface GraphQLError {
  message: string;
  extensions?: { code?: string; [k: string]: unknown };
  path?: (string | number)[];
  locations?: { line: number; column: number }[];
}

export interface ThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface CostExtensions {
  requestedQueryCost?: number;
  actualQueryCost?: number;
  throttleStatus?: ThrottleStatus;
}

export interface ShopifyResponse<T> {
  data: T;
  extensions?: { cost?: CostExtensions };
}

interface RawGraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: { cost?: CostExtensions };
}

function buildEndpoint(): string {
  const { storeDomain } = getCredentials();
  return `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

function isThrottled(errors?: GraphQLError[]): boolean {
  if (!errors || errors.length === 0) return false;
  return errors.some((e) => e.extensions?.code === 'THROTTLED');
}

function throttleDelayMs(cost?: CostExtensions): number {
  const status = cost?.throttleStatus;
  const requested = cost?.requestedQueryCost ?? 0;
  if (!status || requested <= 0 || status.restoreRate <= 0) return RETRY_BASE_DELAY_MS;
  const need = Math.max(0, requested - status.currentlyAvailable);
  return Math.min(60_000, Math.ceil((need / status.restoreRate) * 1000) + 250);
}

export async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<ShopifyResponse<T>> {
  return executeWithRetry<T>(query, variables, 0);
}

async function executeWithRetry<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  attempt: number
): Promise<ShopifyResponse<T>> {
  const token = await getAccessToken();
  const url = buildEndpoint();

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Shopify-Access-Token': token,
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    if (attempt === 0) {
      await sleep(RETRY_BASE_DELAY_MS);
      return executeWithRetry<T>(query, variables, attempt + 1);
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw new ShopifyApiError('NETWORK', 0, `Request failed: ${detail}`);
  }

  if (response.status === 401 || response.status === 403) {
    if (attempt === 0) {
      clearTokenCache();
      return executeWithRetry<T>(query, variables, attempt + 1);
    }
    throw new ShopifyApiError(
      'AUTH',
      response.status,
      `Authentication failed (${response.status}). Check SHOPIFY_CLIENT_ID/SECRET and app scopes.`
    );
  }

  if (response.status === 429) {
    if (attempt === 0) {
      const retryAfter = Number(response.headers.get('Retry-After'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(60_000, retryAfter * 1000)
        : RETRY_BASE_DELAY_MS * 2;
      await sleep(delay);
      return executeWithRetry<T>(query, variables, attempt + 1);
    }
    throw new ShopifyApiError('THROTTLE', 429, 'Shopify rate limit exceeded after retry');
  }

  if (response.status >= 500 && response.status < 600) {
    if (attempt === 0) {
      await sleep(RETRY_BASE_DELAY_MS);
      return executeWithRetry<T>(query, variables, attempt + 1);
    }
    throw new ShopifyApiError(
      'HTTP',
      response.status,
      `Shopify server error ${response.status} ${response.statusText}`
    );
  }

  if (!response.ok) {
    const text = await response.text();
    throw new ShopifyApiError(
      'HTTP',
      response.status,
      `Shopify HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`
    );
  }

  let parsed: RawGraphQLResponse<T>;
  try {
    parsed = (await response.json()) as RawGraphQLResponse<T>;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ShopifyApiError('PARSE', response.status, `Invalid JSON response: ${detail}`);
  }

  if (isThrottled(parsed.errors)) {
    if (attempt === 0) {
      await sleep(throttleDelayMs(parsed.extensions?.cost));
      return executeWithRetry<T>(query, variables, attempt + 1);
    }
    throw new ShopifyApiError('THROTTLE', 200, 'GraphQL THROTTLED after retry', parsed.errors);
  }

  if (parsed.errors && parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new ShopifyApiError(
      'GRAPHQL',
      response.status,
      `GraphQL error: ${first.message}`,
      parsed.errors
    );
  }

  if (parsed.data === undefined) {
    throw new ShopifyApiError('GRAPHQL', response.status, 'GraphQL response missing data field');
  }

  return { data: parsed.data, extensions: parsed.extensions };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
