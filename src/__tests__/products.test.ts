import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addProductTag,
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  removeProductTag,
  searchProducts,
  updateProduct,
} from '../tools/products.js';
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
    scope: 'read_products,write_products',
    expires_in: 86399,
  });
}

const sampleProduct = {
  id: 'gid://shopify/Product/1',
  title: 'Test T-Shirt',
  handle: 'test-t-shirt',
  status: 'ACTIVE',
  productType: 'Shirt',
  vendor: 'Acme',
  tags: ['tee'],
  descriptionHtml: '<p>desc</p>',
  totalInventory: 10,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-04-01T00:00:00Z',
  publishedAt: '2026-01-02T00:00:00Z',
  priceRangeV2: {
    minVariantPrice: { amount: '10.00', currencyCode: 'CHF' },
    maxVariantPrice: { amount: '20.00', currencyCode: 'CHF' },
  },
  options: [{ id: 'gid://shopify/ProductOption/1', name: 'Size', position: 1, values: ['S', 'M'] }],
  variants: {
    pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
    edges: [{
      node: {
        id: 'gid://shopify/ProductVariant/1',
        title: 'S',
        sku: 'TS-S',
        price: '10.00',
        compareAtPrice: null,
        barcode: null,
        inventoryQuantity: 5,
        availableForSale: true,
      },
    }],
  },
  images: {
    pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'cur', startCursor: null },
    edges: [{
      node: { id: 'gid://shopify/MediaImage/1', altText: null, url: 'https://x', width: 100, height: 100 },
    }],
  },
};

describe('product tools', () => {
  beforeEach(() => {
    setEnv();
    clearTokenCache();
  });
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    clearEnv();
    clearTokenCache();
  });

  it('listProducts returns paginated items, totalCount=unknown', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: 'next', startCursor: 'first' },
            edges: [{ node: sampleProduct }],
          },
        },
      })) as unknown as typeof fetch;

    const result = await listProducts({ first: 10 });
    expect(result.totalCount).toBe('unknown');
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('Test T-Shirt');
    expect(result.items[0].variants.truncated).toBe(false);
    expect(result.items[0].images.truncated).toBe(true);
  });

  it('getProduct shapes a single product', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { product: sampleProduct } })) as unknown as typeof fetch;

    const result = await getProduct({ id: '1' });
    expect(result.product?.id).toBe('gid://shopify/Product/1');
    expect(result.product?.variants.items).toHaveLength(1);
  });

  it('getProduct returns null + error message when not found', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { product: null } })) as unknown as typeof fetch;

    const result = await getProduct({ id: 'gid://shopify/Product/999' });
    expect(result.product).toBeNull();
    expect(result.error).toContain('999');
  });

  it('searchProducts rejects empty query', async () => {
    await expect(searchProducts({ query: '   ' })).rejects.toThrow(/non-empty/);
  });

  it('searchProducts forwards query to listProducts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null },
            edges: [{ node: sampleProduct }],
          },
        },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await searchProducts({ query: 'shirt', first: 5 });
    expect(result.items).toHaveLength(1);

    const [, init] = fetchMock.mock.calls[1];
    const body = JSON.parse((init as RequestInit).body as string) as { variables: Record<string, unknown> };
    expect(body.variables.query).toBe('shirt');
    expect(body.variables.sortKey).toBe('RELEVANCE');
    expect(body.variables.first).toBe(5);
  });

  it('createProduct sends ProductCreateInput and returns product + userErrors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: {
          productCreate: {
            product: sampleProduct,
            userErrors: [],
          },
        },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await createProduct({ title: 'New Tee', vendor: 'Acme', tags: ['tee'] });
    expect(result.product?.id).toBe('gid://shopify/Product/1');
    expect(result.userErrors).toEqual([]);

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      query: string;
      variables: { product: Record<string, unknown> };
    };
    expect(body.query).toContain('productCreate(product: $product)');
    expect(body.variables.product).toEqual({ title: 'New Tee', vendor: 'Acme', tags: ['tee'] });
  });

  it('createProduct rejects empty title', async () => {
    await expect(createProduct({ title: '   ' })).rejects.toThrow(/title/);
  });

  it('createProduct surfaces userErrors verbatim', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: {
          productCreate: {
            product: null,
            userErrors: [{ field: ['title'], message: 'Title is too short', code: 'TOO_SHORT' }],
          },
        },
      })) as unknown as typeof fetch;

    const result = await createProduct({ title: 'x' });
    expect(result.product).toBeNull();
    expect(result.userErrors[0].message).toContain('too short');
  });

  it('updateProduct converts numeric id to GID and sends only provided fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { productUpdate: { product: sampleProduct, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await updateProduct({ id: '42', vendor: 'Beta' });

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { product: Record<string, unknown> };
    };
    expect(body.variables.product.id).toBe('gid://shopify/Product/42');
    expect(body.variables.product.vendor).toBe('Beta');
    expect(Object.keys(body.variables.product).sort()).toEqual(['id', 'vendor']);
  });

  it('archiveProduct without confirm returns soft-confirm response without calling API', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await archiveProduct({ id: '7' });
    expect(result).toMatchObject({
      requiresConfirmation: true,
      productId: 'gid://shopify/Product/7',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('archiveProduct with confirm=true issues productUpdate(status: ARCHIVED)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { productUpdate: { product: { ...sampleProduct, status: 'ARCHIVED' }, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await archiveProduct({ id: '7', confirm: true });
    expect((result as { product: { status: string } | null }).product?.status).toBe('ARCHIVED');

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as {
      variables: { product: Record<string, unknown> };
    };
    expect(body.variables.product.status).toBe('ARCHIVED');
  });

  it('addProductTag uses tagsAdd mutation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { tagsAdd: { node: { id: 'gid://shopify/Product/1', tags: ['tee', 'sale'] }, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await addProductTag({ productId: '1', tags: ['sale'] });
    expect(result.node?.tags).toContain('sale');

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { query: string };
    expect(body.query).toContain('tagsAdd(id: $id, tags: $tags)');
  });

  it('removeProductTag uses tagsRemove mutation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(jsonResponse({
        data: { tagsRemove: { node: { id: 'gid://shopify/Product/1', tags: [] }, userErrors: [] } },
      }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await removeProductTag({ productId: '1', tags: ['sale'] });

    const body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as { query: string };
    expect(body.query).toContain('tagsRemove(id: $id, tags: $tags)');
  });

  it('addProductTag rejects empty tags array', async () => {
    await expect(addProductTag({ productId: '1', tags: [] })).rejects.toThrow(/tags/);
  });
});
