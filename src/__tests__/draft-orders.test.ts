import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeDraftOrder, createDraftOrder } from '../tools/draft-orders.js';
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
  return jsonResponse({ access_token: 'tok-abc', scope: 'write_draft_orders', expires_in: 86399 });
}

describe('draft-order tools', () => {
  beforeEach(() => { setEnv(); clearTokenCache(); });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; clearEnv(); clearTokenCache(); });

  it('createDraftOrder rejects empty lineItems', async () => {
    await expect(createDraftOrder({ lineItems: [] })).rejects.toThrow(/line item/);
  });

  it('createDraftOrder GIDs variantId and customerId', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { draftOrderCreate: { draftOrder: { id: 'gid://shopify/DraftOrder/1' }, userErrors: [] } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await createDraftOrder({
      customerId: '77',
      lineItems: [{ variantId: '5', quantity: 2 }],
    });

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { input: { customerId: string; lineItems: Array<{ variantId?: string; quantity: number }> } };
    };
    expect(body.variables.input.customerId).toBe('gid://shopify/Customer/77');
    expect(body.variables.input.lineItems[0].variantId).toBe('gid://shopify/ProductVariant/5');
    expect(body.variables.input.lineItems[0].quantity).toBe(2);
  });

  it('completeDraftOrder without confirm is a soft-confirm no-op', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await completeDraftOrder({ id: '1' });
    expect(r).toMatchObject({ requiresConfirmation: true, draftOrderId: 'gid://shopify/DraftOrder/1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('completeDraftOrder with confirm fires the mutation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { draftOrderComplete: { draftOrder: { id: 'gid://shopify/DraftOrder/1' }, userErrors: [] } } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await completeDraftOrder({ id: '1', confirm: true, paymentPending: true });
    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { id: string; paymentPending: boolean };
    };
    expect(body.variables.id).toBe('gid://shopify/DraftOrder/1');
    expect(body.variables.paymentPending).toBe(true);
  });
});
