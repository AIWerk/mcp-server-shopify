import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCustomerNote,
  createCustomer,
  getCustomer,
  listCustomers,
  searchCustomers,
  updateCustomer,
} from '../tools/customers.js';
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
  return jsonResponse({ access_token: 'tok-abc', scope: 'read_customers,write_customers', expires_in: 86399 });
}

const sampleCustomer = {
  id: 'gid://shopify/Customer/77',
  firstName: 'Buy',
  lastName: 'Er',
  displayName: 'Buy Er',
  email: 'b@e.com',
  phone: null,
  verifiedEmail: false,
  state: 'ENABLED',
  note: 'existing',
  tags: [],
  locale: 'en',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  numberOfOrders: '0',
  amountSpent: { amount: '0.00', currencyCode: 'CHF' },
  defaultAddress: null,
  addresses: {
    pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
    edges: [],
  },
};

describe('customer tools', () => {
  beforeEach(() => { setEnv(); clearTokenCache(); });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; clearEnv(); clearTokenCache(); });

  it('listCustomers shapes nodes and exposes pageInfo', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { customers: {
          pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
          edges: [{ node: sampleCustomer }],
        } },
      })) as unknown as typeof fetch;

    const r = await listCustomers({});
    expect(r.items[0].displayName).toBe('Buy Er');
    expect(r.items[0].addresses.truncated).toBe(false);
    expect(r.totalCount).toBe('unknown');
  });

  it('getCustomer GIDs the input', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { customer: sampleCustomer } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await getCustomer({ id: '77' });
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { variables: { id: string } };
    expect(body.variables.id).toBe('gid://shopify/Customer/77');
  });

  it('searchCustomers rejects empty query', async () => {
    await expect(searchCustomers({ query: '' })).rejects.toThrow(/non-empty/);
  });

  it('createCustomer requires email or phone', async () => {
    await expect(createCustomer({ firstName: 'X' })).rejects.toThrow(/email or phone/);
  });

  it('createCustomer sends only provided fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { customerCreate: { customer: sampleCustomer, userErrors: [] } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createCustomer({ email: 'x@y.com', firstName: 'X' });
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { input: Record<string, unknown> };
    };
    expect(Object.keys(body.variables.input).sort()).toEqual(['email', 'firstName']);
  });

  it('updateCustomer GIDs the id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { customerUpdate: { customer: sampleCustomer, userErrors: [] } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await updateCustomer({ id: '77', tags: ['vip'] });
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { input: { id: string; tags: string[] } };
    };
    expect(body.variables.input.id).toBe('gid://shopify/Customer/77');
    expect(body.variables.input.tags).toEqual(['vip']);
  });

  it('addCustomerNote append concatenates with existing', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { customer: { id: 'gid://shopify/Customer/77', note: 'prev' } } }))
      .mockResolvedValueOnce(jsonResponse({ data: { customerUpdate: { customer: { ...sampleCustomer, note: 'prev\n\nadd' }, userErrors: [] } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await addCustomerNote({ id: '77', note: 'add' });
    expect((r as { customer: { note: string | null } | null }).customer?.note).toBe('prev\n\nadd');
  });
});
