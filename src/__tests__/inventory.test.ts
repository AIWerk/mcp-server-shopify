import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adjustInventoryLevel, getInventoryLevel } from '../tools/inventory.js';
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
  return jsonResponse({ access_token: 'tok-abc', scope: 'read_inventory,write_inventory', expires_in: 86399 });
}

describe('inventory tools', () => {
  beforeEach(() => { setEnv(); clearTokenCache(); });
  afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; clearEnv(); clearTokenCache(); });

  it('getInventoryLevel returns levels for found item', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: {
        inventoryItem: {
          id: 'gid://shopify/InventoryItem/9',
          sku: 'TS-S',
          tracked: true,
          variant: { id: 'gid://shopify/ProductVariant/1', title: 'S', sku: 'TS-S' },
          inventoryLevel: {
            id: 'gid://shopify/InventoryLevel/L',
            location: { id: 'gid://shopify/Location/2', name: 'Main' },
            quantities: [{ name: 'available', quantity: 5 }, { name: 'on_hand', quantity: 5 }],
          },
        },
      } })) as unknown as typeof fetch;

    const r = await getInventoryLevel({ inventoryItemId: '9', locationId: '2' });
    expect(r.inventoryItem?.inventoryLevel?.quantities).toHaveLength(2);
  });

  it('getInventoryLevel surfaces error when item not found', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { inventoryItem: null } })) as unknown as typeof fetch;

    const r = await getInventoryLevel({ inventoryItemId: '9', locationId: '2' });
    expect(r.error).toContain('not found');
  });

  it('adjustInventoryLevel rejects zero delta', async () => {
    await expect(adjustInventoryLevel({
      inventoryItemId: '9', locationId: '2', delta: 0,
    })).rejects.toThrow(/non-zero/);
  });

  it('adjustInventoryLevel sends inventoryAdjustQuantitiesInput with default reason+name', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: {
        inventoryItem: {
          inventoryLevel: { quantities: [{ name: 'available', quantity: 5 }] },
        },
      } }))
      .mockResolvedValueOnce(jsonResponse({ data: {
        inventoryAdjustQuantities: {
          inventoryAdjustmentGroup: {
            id: 'gid://shopify/InventoryAdjustmentGroup/X',
            createdAt: '2026-04-27T00:00:00Z',
            reason: 'correction',
            referenceDocumentUri: null,
            changes: [{
              name: 'available', delta: 3, quantityAfterChange: 8,
              location: { id: 'gid://shopify/Location/2', name: 'Main' },
            }],
          },
          userErrors: [],
        },
      } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await adjustInventoryLevel({ inventoryItemId: '9', locationId: '2', delta: 3 });
    expect(r.adjustment?.changes[0].quantityAfterChange).toBe(8);

    const body = JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string) as {
      variables: { input: { reason: string; name: string; changes: Array<{ delta: number; changeFromQuantity: number }> } };
    };
    expect(body.variables.input.reason).toBe('correction');
    expect(body.variables.input.name).toBe('available');
    expect(body.variables.input.changes[0].delta).toBe(3);
    expect(body.variables.input.changes[0].changeFromQuantity).toBe(5);
  });

  it('adjustInventoryLevel surfaces userError when level not found', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { inventoryItem: null } })) as unknown as typeof fetch;

    const r = await adjustInventoryLevel({ inventoryItemId: '9', locationId: '2', delta: 3 });
    expect(r.adjustment).toBeNull();
    expect(r.userErrors[0].message).toContain('not found');
  });
});
