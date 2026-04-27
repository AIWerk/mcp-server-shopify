// Shop-level read tools: get_shop_info, list_collections, list_locations, list_metafields.

import { shopifyGraphQL } from '../api.js';
import {
  buildGid,
  flattenConnection,
  type PageInfo,
  withTruncationMarker,
} from '../types.js';

export async function getShopInfo() {
  const query = `
    query GetShopInfo {
      shop {
        id
        name
        email
        myshopifyDomain
        primaryDomain { url host }
        url
        contactEmail
        currencyCode
        timezoneAbbreviation
        timezoneOffset
        weightUnit
        billingAddress {
          address1 address2 city province country zip phone
        }
        plan { displayName partnerDevelopment shopifyPlus }
        ianaTimezone
      }
    }
  `;
  const { data } = await shopifyGraphQL<{ shop: unknown }>(query);
  return { shop: data.shop };
}

export interface ListCollectionsInput {
  first?: number;
  after?: string;
  query?: string;
  reverse?: boolean;
}

export async function listCollections(input: ListCollectionsInput = {}) {
  const first = clampFirst(input.first, 50);
  const variables: Record<string, unknown> = {
    first,
    after: input.after ?? null,
    query: input.query ?? null,
    reverse: input.reverse ?? false,
  };

  const query = `
    query ListCollections($first: Int!, $after: String, $query: String, $reverse: Boolean!) {
      collections(first: $first, after: $after, query: $query, reverse: $reverse) {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            updatedAt
            sortOrder
            templateSuffix
            productsCount { count precision }
          }
        }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    collections: { pageInfo: PageInfo; edges: Array<{ node: unknown }> };
  }>(query, variables);

  const flat = flattenConnection(data.collections);
  return {
    items: flat.items,
    pageInfo: flat.pageInfo,
    totalCount: 'unknown' as const,
  };
}

export interface ListLocationsInput {
  first?: number;
  after?: string;
  includeInactive?: boolean;
  includeLegacy?: boolean;
}

export async function listLocations(input: ListLocationsInput = {}) {
  const first = clampFirst(input.first, 50);
  const variables: Record<string, unknown> = {
    first,
    after: input.after ?? null,
    includeInactive: input.includeInactive ?? false,
    includeLegacy: input.includeLegacy ?? false,
  };

  const query = `
    query ListLocations($first: Int!, $after: String, $includeInactive: Boolean!, $includeLegacy: Boolean!) {
      locations(first: $first, after: $after, includeInactive: $includeInactive, includeLegacy: $includeLegacy) {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges {
          node {
            id
            name
            isActive
            isPrimary
            shipsInventory
            fulfillsOnlineOrders
            address {
              address1 address2 city province country zip phone countryCode provinceCode
            }
          }
        }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    locations: { pageInfo: PageInfo; edges: Array<{ node: unknown }> };
  }>(query, variables);

  const flat = flattenConnection(data.locations);
  return {
    items: flat.items,
    pageInfo: flat.pageInfo,
    totalCount: 'unknown' as const,
  };
}

const VALID_OWNER_TYPES = [
  'PRODUCT',
  'PRODUCTVARIANT',
  'CUSTOMER',
  'ORDER',
  'COLLECTION',
  'SHOP',
  'COMPANY',
  'LOCATION',
] as const;
export type MetafieldOwnerType = (typeof VALID_OWNER_TYPES)[number];

export interface ListMetafieldsInput {
  ownerId: string;
  ownerType: MetafieldOwnerType;
  first?: number;
  after?: string;
  namespace?: string;
}

export async function listMetafields(input: ListMetafieldsInput) {
  const first = clampFirst(input.first, 50);
  const ownerId = buildGid(ownerTypeToResource(input.ownerType), input.ownerId);

  // Each owner type exposes its metafields differently. We dispatch on
  // ownerType to a small set of GraphQL queries, all with the same shape.
  const query = `
    query OwnerMetafields(
      $ownerId: ID!
      $first: Int!
      $after: String
      $namespace: String
    ) {
      node(id: $ownerId) {
        id
        ... on HasMetafields {
          metafields(first: $first, after: $after, namespace: $namespace) {
            pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
            edges {
              node {
                id
                namespace
                key
                value
                type
                description
                createdAt
                updatedAt
              }
            }
          }
        }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    node:
      | {
          id: string;
          metafields?: { pageInfo: PageInfo; edges: Array<{ node: unknown }> };
        }
      | null;
  }>(query, {
    ownerId,
    first,
    after: input.after ?? null,
    namespace: input.namespace ?? null,
  });

  if (!data.node || !data.node.metafields) {
    return {
      items: [],
      pageInfo: emptyPageInfo(),
      truncated: false,
      totalCount: 'unknown' as const,
      error: `No metafields available for ${ownerId}`,
    };
  }

  const flat = flattenConnection(data.node.metafields);
  const t = withTruncationMarker(flat.items, flat.pageInfo.hasNextPage);
  return {
    items: t.items,
    pageInfo: flat.pageInfo,
    truncated: t.truncated,
    totalCount: 'unknown' as const,
  };
}

function ownerTypeToResource(t: MetafieldOwnerType): string {
  switch (t) {
    case 'PRODUCT': return 'Product';
    case 'PRODUCTVARIANT': return 'ProductVariant';
    case 'CUSTOMER': return 'Customer';
    case 'ORDER': return 'Order';
    case 'COLLECTION': return 'Collection';
    case 'SHOP': return 'Shop';
    case 'COMPANY': return 'Company';
    case 'LOCATION': return 'Location';
  }
}

function emptyPageInfo(): PageInfo {
  return { hasNextPage: false, hasPreviousPage: false, endCursor: null, startCursor: null };
}

function clampFirst(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > 250) return 250;
  return Math.floor(value);
}
