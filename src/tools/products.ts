// Product read tools: list_products, get_product, search_products.

import { shopifyGraphQL } from '../api.js';
import {
  buildGid,
  flattenConnection,
  type PageInfo,
  withTruncationMarker,
} from '../types.js';

const PRODUCT_FRAGMENT = `
  fragment ProductFields on Product {
    id
    title
    handle
    status
    productType
    vendor
    tags
    descriptionHtml
    totalInventory
    createdAt
    updatedAt
    publishedAt
    priceRangeV2 {
      minVariantPrice { amount currencyCode }
      maxVariantPrice { amount currencyCode }
    }
    options { id name position values }
    variants(first: 250) {
      pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
      edges {
        node {
          id
          title
          sku
          price
          compareAtPrice
          barcode
          inventoryQuantity
          availableForSale
        }
      }
    }
    images(first: 250) {
      pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
      edges {
        node { id altText url width height }
      }
    }
  }
`;

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  productType: string;
  vendor: string;
  tags: string[];
  descriptionHtml: string;
  totalInventory: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string };
    maxVariantPrice: { amount: string; currencyCode: string };
  };
  options: Array<{ id: string; name: string; position: number; values: string[] }>;
  variants: {
    pageInfo: PageInfo;
    edges: Array<{ node: unknown }>;
  };
  images: {
    pageInfo: PageInfo;
    edges: Array<{ node: unknown }>;
  };
}

function shapeProduct(p: ProductNode) {
  const variants = flattenConnection(p.variants);
  const images = flattenConnection(p.images);
  return {
    id: p.id,
    title: p.title,
    handle: p.handle,
    status: p.status,
    productType: p.productType,
    vendor: p.vendor,
    tags: p.tags,
    descriptionHtml: p.descriptionHtml,
    totalInventory: p.totalInventory,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    publishedAt: p.publishedAt,
    priceRange: p.priceRangeV2,
    options: p.options,
    variants: withTruncationMarker(variants.items, p.variants.pageInfo.hasNextPage),
    images: withTruncationMarker(images.items, p.images.pageInfo.hasNextPage),
  };
}

const VALID_SORT_KEYS = [
  'TITLE',
  'PRODUCT_TYPE',
  'VENDOR',
  'INVENTORY_TOTAL',
  'UPDATED_AT',
  'CREATED_AT',
  'PUBLISHED_AT',
  'ID',
  'RELEVANCE',
] as const;
export type ProductSortKey = (typeof VALID_SORT_KEYS)[number];

export interface ListProductsInput {
  first?: number;
  after?: string;
  query?: string;
  sortKey?: ProductSortKey;
  reverse?: boolean;
}

export async function listProducts(input: ListProductsInput = {}) {
  const first = clampFirst(input.first, 50);
  const variables: Record<string, unknown> = {
    first,
    after: input.after ?? null,
    query: input.query ?? null,
    sortKey: input.sortKey ?? null,
    reverse: input.reverse ?? false,
  };

  const query = `
    ${PRODUCT_FRAGMENT}
    query ListProducts(
      $first: Int!
      $after: String
      $query: String
      $sortKey: ProductSortKeys
      $reverse: Boolean!
    ) {
      products(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges { node { ...ProductFields } }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    products: { pageInfo: PageInfo; edges: Array<{ node: ProductNode }> };
  }>(query, variables);

  const flat = flattenConnection(data.products);
  return {
    items: flat.items.map(shapeProduct),
    pageInfo: flat.pageInfo,
    totalCount: 'unknown' as const,
  };
}

export interface GetProductInput {
  id: string;
}

export async function getProduct(input: GetProductInput) {
  const id = buildGid('Product', input.id);
  const query = `
    ${PRODUCT_FRAGMENT}
    query GetProduct($id: ID!) {
      product(id: $id) { ...ProductFields }
    }
  `;
  const { data } = await shopifyGraphQL<{ product: ProductNode | null }>(query, { id });
  if (!data.product) {
    return { product: null, error: `Product not found: ${id}` };
  }
  return { product: shapeProduct(data.product) };
}

export interface SearchProductsInput {
  query: string;
  first?: number;
  after?: string;
  sortKey?: ProductSortKey;
  reverse?: boolean;
}

export async function searchProducts(input: SearchProductsInput) {
  if (!input.query || input.query.trim().length === 0) {
    throw new Error('search_products requires a non-empty query');
  }
  return listProducts({
    first: input.first,
    after: input.after,
    query: input.query,
    sortKey: input.sortKey ?? 'RELEVANCE',
    reverse: input.reverse,
  });
}

function clampFirst(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > 250) return 250;
  return Math.floor(value);
}

// ---- Write tools ----

type ProductStatus = 'ACTIVE' | 'ARCHIVED' | 'DRAFT';

export interface CreateProductInput {
  title: string;
  descriptionHtml?: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  status?: ProductStatus;
  handle?: string;
}

export async function createProduct(input: CreateProductInput) {
  if (!input.title || input.title.trim().length === 0) {
    throw new Error('create_product requires a non-empty title');
  }
  const product: Record<string, unknown> = { title: input.title };
  if (input.descriptionHtml !== undefined) product.descriptionHtml = input.descriptionHtml;
  if (input.productType !== undefined) product.productType = input.productType;
  if (input.vendor !== undefined) product.vendor = input.vendor;
  if (input.tags !== undefined) product.tags = input.tags;
  if (input.status !== undefined) product.status = input.status;
  if (input.handle !== undefined) product.handle = input.handle;

  const query = `
    ${PRODUCT_FRAGMENT}
    mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { ...ProductFields }
        userErrors { field message code }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    productCreate: {
      product: ProductNode | null;
      userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
    };
  }>(query, { product });

  return {
    product: data.productCreate.product ? shapeProduct(data.productCreate.product) : null,
    userErrors: data.productCreate.userErrors,
  };
}

export interface UpdateProductInput {
  id: string;
  title?: string;
  descriptionHtml?: string;
  productType?: string;
  vendor?: string;
  tags?: string[];
  status?: ProductStatus;
  handle?: string;
}

export async function updateProduct(input: UpdateProductInput) {
  const id = buildGid('Product', input.id);
  const product: Record<string, unknown> = { id };
  if (input.title !== undefined) product.title = input.title;
  if (input.descriptionHtml !== undefined) product.descriptionHtml = input.descriptionHtml;
  if (input.productType !== undefined) product.productType = input.productType;
  if (input.vendor !== undefined) product.vendor = input.vendor;
  if (input.tags !== undefined) product.tags = input.tags;
  if (input.status !== undefined) product.status = input.status;
  if (input.handle !== undefined) product.handle = input.handle;

  const query = `
    ${PRODUCT_FRAGMENT}
    mutation UpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { ...ProductFields }
        userErrors { field message code }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    productUpdate: {
      product: ProductNode | null;
      userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
    };
  }>(query, { product });

  return {
    product: data.productUpdate.product ? shapeProduct(data.productUpdate.product) : null,
    userErrors: data.productUpdate.userErrors,
  };
}

export interface ArchiveProductInput {
  id: string;
  confirm?: boolean;
}

export async function archiveProduct(input: ArchiveProductInput) {
  const id = buildGid('Product', input.id);
  if (input.confirm !== true) {
    return {
      requiresConfirmation: true,
      action: `Archive product ${id} (hides from sale; reversible by setting status back to ACTIVE)`,
      hint: 'Pass confirm: true to proceed',
      productId: id,
    };
  }
  return updateProduct({ id, status: 'ARCHIVED' });
}

export interface ProductTagInput {
  productId: string;
  tags: string[];
}

export async function addProductTag(input: ProductTagInput) {
  return modifyProductTags(input, 'add');
}

export async function removeProductTag(input: ProductTagInput) {
  return modifyProductTags(input, 'remove');
}

async function modifyProductTags(
  input: ProductTagInput,
  op: 'add' | 'remove'
): Promise<{
  node: { id: string; tags?: string[] } | null;
  userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
}> {
  if (!Array.isArray(input.tags) || input.tags.length === 0) {
    throw new Error(`${op}_product_tag requires a non-empty tags array`);
  }
  const id = buildGid('Product', input.productId);
  const mutationName = op === 'add' ? 'tagsAdd' : 'tagsRemove';
  const query = `
    mutation ModifyTags($id: ID!, $tags: [String!]!) {
      ${mutationName}(id: $id, tags: $tags) {
        node { id ... on Product { tags } }
        userErrors { field message code }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    [key: string]: {
      node: { id: string; tags?: string[] } | null;
      userErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
    };
  }>(query, { id, tags: input.tags });

  return data[mutationName];
}
