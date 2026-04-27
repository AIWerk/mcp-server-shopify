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
