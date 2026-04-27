import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addOrderNote,
  cancelOrder,
  getOrder,
  listOrders,
  markOrderPaid,
  searchOrders,
} from '../tools/orders.js';
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
    scope: 'read_orders,write_orders',
    expires_in: 86399,
  });
}

const sampleOrder = {
  id: 'gid://shopify/Order/1001',
  name: '#1001',
  legacyResourceId: '1001',
  email: 'buyer@example.com',
  phone: null,
  note: 'existing note',
  tags: [],
  displayFinancialStatus: 'PAID',
  displayFulfillmentStatus: 'UNFULFILLED',
  cancelledAt: null,
  cancelReason: null,
  closed: false,
  closedAt: null,
  confirmed: true,
  createdAt: '2026-04-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  processedAt: '2026-04-01T00:00:00Z',
  currencyCode: 'CHF',
  totalPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'CHF' }, presentmentMoney: { amount: '20.00', currencyCode: 'CHF' } },
  subtotalPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'CHF' } },
  totalShippingPriceSet: { shopMoney: { amount: '0.00', currencyCode: 'CHF' } },
  totalTaxSet: { shopMoney: { amount: '0.00', currencyCode: 'CHF' } },
  totalRefundedSet: { shopMoney: { amount: '0.00', currencyCode: 'CHF' } },
  customer: { id: 'gid://shopify/Customer/77', email: 'buyer@example.com', firstName: 'B', lastName: 'U' },
  shippingAddress: null,
  billingAddress: null,
  lineItems: {
    pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
    edges: [{
      node: {
        id: 'gid://shopify/LineItem/1',
        title: 'Test T-Shirt',
        quantity: 1,
        sku: 'TS-S',
        variantTitle: 'S',
        vendor: 'Acme',
        originalUnitPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'CHF' } },
        discountedUnitPriceSet: { shopMoney: { amount: '20.00', currencyCode: 'CHF' } },
      },
    }],
  },
};

describe('order tools', () => {
  beforeEach(() => {
    setEnv();
    clearTokenCache();
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    clearEnv();
    clearTokenCache();
  });

  it('listOrders shapes orders with truncation markers on lineItems', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: {
          orders: {
            pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
            edges: [{ node: sampleOrder }],
          },
        },
      })) as unknown as typeof fetch;

    const result = await listOrders({ first: 10 });
    expect(result.totalCount).toBe('unknown');
    expect(result.items[0].name).toBe('#1001');
    expect(result.items[0].lineItems.truncated).toBe(false);
    expect(result.items[0].lineItems.items).toHaveLength(1);
  });

  it('getOrder fetches by GID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { order: sampleOrder } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await getOrder({ id: '1001' });
    expect(result.order?.id).toBe('gid://shopify/Order/1001');

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { variables: { id: string } };
    expect(body.variables.id).toBe('gid://shopify/Order/1001');
  });

  it('getOrder returns null + error for missing order', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { order: null } })) as unknown as typeof fetch;

    const result = await getOrder({ id: '999' });
    expect(result.order).toBeNull();
    expect(result.error).toContain('999');
  });

  it('searchOrders rejects empty query', async () => {
    await expect(searchOrders({ query: '' })).rejects.toThrow(/non-empty/);
  });

  it('markOrderPaid wraps id in OrderMarkAsPaidInput', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { orderMarkAsPaid: { order: sampleOrder, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await markOrderPaid({ id: '1001' });

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { input: { id: string } };
    };
    expect(body.variables.input.id).toBe('gid://shopify/Order/1001');
  });

  it('cancelOrder without confirm is a no-op soft-confirm', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await cancelOrder({ id: '1001' });
    expect(result).toMatchObject({ requiresConfirmation: true, orderId: 'gid://shopify/Order/1001' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancelOrder with confirm calls orderCancel and merges userErrors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: {
          orderCancel: {
            job: { id: 'gid://shopify/Job/x', done: false },
            orderCancelUserErrors: [{ field: ['restock'], message: 'restock failed', code: 'X' }],
            userErrors: [{ field: null, message: 'top-level' }],
          },
        },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await cancelOrder({ id: '1001', confirm: true, reason: 'CUSTOMER' });
    expect((result as { job: { id: string } | null }).job?.id).toBe('gid://shopify/Job/x');
    expect((result as { userErrors: unknown[] }).userErrors).toHaveLength(2);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { variables: Record<string, unknown> };
    expect(body.variables.reason).toBe('CUSTOMER');
    expect(body.variables.restock).toBe(true);
    expect(body.variables.refund).toBe(false);
  });

  it('addOrderNote append fetches existing note and concatenates', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { order: { id: 'gid://shopify/Order/1001', note: 'existing note' } } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { orderUpdate: { order: { ...sampleOrder, note: 'existing note\n\nnew line' }, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await addOrderNote({ id: '1001', note: 'new line' });
    expect((result as { order: { note: string | null } | null }).order?.note).toBe('existing note\n\nnew line');

    const updateBody = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string) as {
      variables: { input: { note: string } };
    };
    expect(updateBody.variables.input.note).toBe('existing note\n\nnew line');
  });

  it('addOrderNote replace skips the read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { orderUpdate: { order: { ...sampleOrder, note: 'fresh' }, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await addOrderNote({ id: '1001', note: 'fresh', mode: 'replace' });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { input: { note: string } };
    };
    expect(body.variables.input.note).toBe('fresh');
  });

  it('addOrderNote returns 404 userError when order not found in append mode', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { order: null } })) as unknown as typeof fetch;

    const result = await addOrderNote({ id: '999', note: 'x' });
    expect((result as { order: unknown }).order).toBeNull();
    expect((result as { userErrors: Array<{ message: string }> }).userErrors[0].message).toContain('999');
  });
});
