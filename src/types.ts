// Common shapes shared across tools.

export interface Money {
  amount: string;
  currencyCode: string;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  endCursor: string | null;
  startCursor: string | null;
}

export interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

export interface PagedResult<T> {
  items: T[];
  pageInfo: PageInfo;
  totalCount?: number | 'unknown';
}

// Shopify Global IDs look like: gid://shopify/Product/123456789
const GID_PREFIX = 'gid://shopify/';

export function buildGid(resource: string, id: string | number): string {
  if (typeof id === 'string' && id.startsWith(GID_PREFIX)) return id;
  return `${GID_PREFIX}${resource}/${id}`;
}

export function parseGid(gid: string): { resource: string; id: string } | null {
  if (!gid.startsWith(GID_PREFIX)) return null;
  const rest = gid.slice(GID_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  return { resource: rest.slice(0, slash), id: rest.slice(slash + 1) };
}

// Extract pageInfo from an Edges-style connection and flatten edges → nodes.
export function flattenConnection<TNode>(connection: {
  edges: Array<{ node: TNode }>;
  pageInfo: PageInfo;
}): { items: TNode[]; pageInfo: PageInfo } {
  return {
    items: connection.edges.map((e) => e.node),
    pageInfo: connection.pageInfo,
  };
}

// Used by tools that cap nested children (variants, images, line items)
// to preserve the "honest pagination" contract.
export function withTruncationMarker<T>(
  items: T[],
  hasNextPage: boolean
): { items: T[]; truncated: boolean } {
  return { items, truncated: hasNextPage };
}
