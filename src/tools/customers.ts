// Customer tools: list, get, search + create, update, add_note.

import { shopifyGraphQL } from '../api.js';
import {
  buildGid,
  flattenConnection,
  type PageInfo,
  withTruncationMarker,
} from '../types.js';

const CUSTOMER_FRAGMENT = `
  fragment CustomerFields on Customer {
    id
    firstName
    lastName
    displayName
    email
    phone
    verifiedEmail
    state
    note
    tags
    locale
    createdAt
    updatedAt
    numberOfOrders
    amountSpent { amount currencyCode }
    defaultAddress {
      address1 address2 city province country zip phone name
    }
    addresses(first: 50) {
      pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
      edges { node { id address1 address2 city province country zip phone name } }
    }
  }
`;

interface CustomerNode {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  verifiedEmail: boolean;
  state: string;
  note: string | null;
  tags: string[];
  locale: string | null;
  createdAt: string;
  updatedAt: string;
  numberOfOrders: string;
  amountSpent: { amount: string; currencyCode: string };
  defaultAddress: unknown;
  addresses: { pageInfo: PageInfo; edges: Array<{ node: unknown }> };
}

function shapeCustomer(c: CustomerNode) {
  const addresses = flattenConnection(c.addresses);
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    displayName: c.displayName,
    email: c.email,
    phone: c.phone,
    verifiedEmail: c.verifiedEmail,
    state: c.state,
    note: c.note,
    tags: c.tags,
    locale: c.locale,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    numberOfOrders: c.numberOfOrders,
    amountSpent: c.amountSpent,
    defaultAddress: c.defaultAddress,
    addresses: withTruncationMarker(addresses.items, c.addresses.pageInfo.hasNextPage),
  };
}

const VALID_CUSTOMER_SORT_KEYS = [
  'CREATED_AT',
  'UPDATED_AT',
  'NAME',
  'LOCATION',
  'ORDERS_COUNT',
  'TOTAL_SPENT',
  'LAST_ORDER_DATE',
  'ID',
  'RELEVANCE',
] as const;
export type CustomerSortKey = (typeof VALID_CUSTOMER_SORT_KEYS)[number];

export interface ListCustomersInput {
  first?: number;
  after?: string;
  query?: string;
  sortKey?: CustomerSortKey;
  reverse?: boolean;
}

export async function listCustomers(input: ListCustomersInput = {}) {
  const first = clampFirst(input.first, 50);
  const variables: Record<string, unknown> = {
    first,
    after: input.after ?? null,
    query: input.query ?? null,
    sortKey: input.sortKey ?? null,
    reverse: input.reverse ?? false,
  };

  const query = `
    ${CUSTOMER_FRAGMENT}
    query ListCustomers(
      $first: Int!
      $after: String
      $query: String
      $sortKey: CustomerSortKeys
      $reverse: Boolean!
    ) {
      customers(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges { node { ...CustomerFields } }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    customers: { pageInfo: PageInfo; edges: Array<{ node: CustomerNode }> };
  }>(query, variables);

  const flat = flattenConnection(data.customers);
  return {
    items: flat.items.map(shapeCustomer),
    pageInfo: flat.pageInfo,
    totalCount: 'unknown' as const,
  };
}

export interface GetCustomerInput {
  id: string;
}

export async function getCustomer(input: GetCustomerInput) {
  const id = buildGid('Customer', input.id);
  const query = `
    ${CUSTOMER_FRAGMENT}
    query GetCustomer($id: ID!) {
      customer(id: $id) { ...CustomerFields }
    }
  `;
  const { data } = await shopifyGraphQL<{ customer: CustomerNode | null }>(query, { id });
  if (!data.customer) return { customer: null, error: `Customer not found: ${id}` };
  return { customer: shapeCustomer(data.customer) };
}

export interface SearchCustomersInput {
  query: string;
  first?: number;
  after?: string;
  sortKey?: CustomerSortKey;
  reverse?: boolean;
}

export async function searchCustomers(input: SearchCustomersInput) {
  if (!input.query || input.query.trim().length === 0) {
    throw new Error('search_customers requires a non-empty query');
  }
  return listCustomers({
    first: input.first,
    after: input.after,
    query: input.query,
    sortKey: input.sortKey ?? 'RELEVANCE',
    reverse: input.reverse,
  });
}

// ---- Write tools ----

export interface CreateCustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  note?: string;
  tags?: string[];
  locale?: string;
}

export async function createCustomer(input: CreateCustomerInput) {
  if (!input.email && !input.phone) {
    throw new Error('create_customer requires at least one of email or phone');
  }
  const customerInput: Record<string, unknown> = {};
  for (const key of ['firstName', 'lastName', 'email', 'phone', 'note', 'tags', 'locale'] as const) {
    if (input[key] !== undefined) customerInput[key] = input[key];
  }

  const query = `
    ${CUSTOMER_FRAGMENT}
    mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { ...CustomerFields }
        userErrors { field message }
      }
    }
  `;
  const { data } = await shopifyGraphQL<{
    customerCreate: {
      customer: CustomerNode | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, { input: customerInput });

  return {
    customer: data.customerCreate.customer ? shapeCustomer(data.customerCreate.customer) : null,
    userErrors: data.customerCreate.userErrors,
  };
}

export interface UpdateCustomerInput {
  id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  note?: string;
  tags?: string[];
  locale?: string;
}

export async function updateCustomer(input: UpdateCustomerInput) {
  const id = buildGid('Customer', input.id);
  const customerInput: Record<string, unknown> = { id };
  for (const key of ['firstName', 'lastName', 'email', 'phone', 'note', 'tags', 'locale'] as const) {
    if (input[key] !== undefined) customerInput[key] = input[key];
  }

  const query = `
    ${CUSTOMER_FRAGMENT}
    mutation UpdateCustomer($input: CustomerInput!) {
      customerUpdate(input: $input) {
        customer { ...CustomerFields }
        userErrors { field message }
      }
    }
  `;
  const { data } = await shopifyGraphQL<{
    customerUpdate: {
      customer: CustomerNode | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, { input: customerInput });

  return {
    customer: data.customerUpdate.customer ? shapeCustomer(data.customerUpdate.customer) : null,
    userErrors: data.customerUpdate.userErrors,
  };
}

export interface AddCustomerNoteInput {
  id: string;
  note: string;
  mode?: 'append' | 'replace';
}

export async function addCustomerNote(input: AddCustomerNoteInput) {
  const id = buildGid('Customer', input.id);
  if (typeof input.note !== 'string' || input.note.length === 0) {
    throw new Error('add_customer_note requires a non-empty note');
  }
  const mode = input.mode ?? 'append';

  let combined = input.note;
  if (mode === 'append') {
    const fetchQuery = `query GetCustomerNote($id: ID!) { customer(id: $id) { id note } }`;
    const fetched = await shopifyGraphQL<{ customer: { id: string; note: string | null } | null }>(
      fetchQuery,
      { id }
    );
    if (!fetched.data.customer) {
      return {
        customer: null,
        userErrors: [{ field: ['id'], message: `Customer not found: ${id}` }],
      };
    }
    const existing = fetched.data.customer.note ?? '';
    combined = existing.length > 0 ? `${existing}\n\n${input.note}` : input.note;
  }

  return updateCustomer({ id, note: combined });
}

function clampFirst(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > 250) return 250;
  return Math.floor(value);
}
