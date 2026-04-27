// Order tools: list, get, search + mark_paid, cancel, add_note.

import { shopifyGraphQL } from '../api.js';
import {
  buildGid,
  flattenConnection,
  type PageInfo,
  withTruncationMarker,
} from '../types.js';

const ORDER_FRAGMENT = `
  fragment OrderFields on Order {
    id
    name
    legacyResourceId
    email
    phone
    note
    tags
    displayFinancialStatus
    displayFulfillmentStatus
    cancelledAt
    cancelReason
    closed
    closedAt
    confirmed
    createdAt
    updatedAt
    processedAt
    currencyCode
    totalPriceSet {
      shopMoney { amount currencyCode }
      presentmentMoney { amount currencyCode }
    }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    totalShippingPriceSet { shopMoney { amount currencyCode } }
    totalTaxSet { shopMoney { amount currencyCode } }
    totalRefundedSet { shopMoney { amount currencyCode } }
    customer {
      id
      email
      firstName
      lastName
    }
    shippingAddress {
      name address1 address2 city province country zip phone
    }
    billingAddress {
      name address1 address2 city province country zip phone
    }
    lineItems(first: 250) {
      pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
      edges {
        node {
          id
          title
          quantity
          sku
          variantTitle
          vendor
          originalUnitPriceSet { shopMoney { amount currencyCode } }
          discountedUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

interface OrderNode {
  id: string;
  name: string;
  legacyResourceId: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  tags: string[];
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  closed: boolean;
  closedAt: string | null;
  confirmed: boolean;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  currencyCode: string;
  totalPriceSet: unknown;
  subtotalPriceSet: unknown;
  totalShippingPriceSet: unknown;
  totalTaxSet: unknown;
  totalRefundedSet: unknown;
  customer: unknown;
  shippingAddress: unknown;
  billingAddress: unknown;
  lineItems: { pageInfo: PageInfo; edges: Array<{ node: unknown }> };
}

function shapeOrder(o: OrderNode) {
  const lineItems = flattenConnection(o.lineItems);
  return {
    id: o.id,
    name: o.name,
    legacyResourceId: o.legacyResourceId,
    email: o.email,
    phone: o.phone,
    note: o.note,
    tags: o.tags,
    displayFinancialStatus: o.displayFinancialStatus,
    displayFulfillmentStatus: o.displayFulfillmentStatus,
    cancelledAt: o.cancelledAt,
    cancelReason: o.cancelReason,
    closed: o.closed,
    closedAt: o.closedAt,
    confirmed: o.confirmed,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    processedAt: o.processedAt,
    currencyCode: o.currencyCode,
    totalPrice: o.totalPriceSet,
    subtotalPrice: o.subtotalPriceSet,
    totalShipping: o.totalShippingPriceSet,
    totalTax: o.totalTaxSet,
    totalRefunded: o.totalRefundedSet,
    customer: o.customer,
    shippingAddress: o.shippingAddress,
    billingAddress: o.billingAddress,
    lineItems: withTruncationMarker(lineItems.items, o.lineItems.pageInfo.hasNextPage),
  };
}

const VALID_ORDER_SORT_KEYS = [
  'PROCESSED_AT',
  'TOTAL_PRICE',
  'ID',
  'CREATED_AT',
  'UPDATED_AT',
  'ORDER_NUMBER',
  'CUSTOMER_NAME',
  'FINANCIAL_STATUS',
  'FULFILLMENT_STATUS',
  'RELEVANCE',
] as const;
export type OrderSortKey = (typeof VALID_ORDER_SORT_KEYS)[number];

export interface ListOrdersInput {
  first?: number;
  after?: string;
  query?: string;
  sortKey?: OrderSortKey;
  reverse?: boolean;
}

export async function listOrders(input: ListOrdersInput = {}) {
  const first = clampFirst(input.first, 50);
  const variables: Record<string, unknown> = {
    first,
    after: input.after ?? null,
    query: input.query ?? null,
    sortKey: input.sortKey ?? null,
    reverse: input.reverse ?? false,
  };

  const query = `
    ${ORDER_FRAGMENT}
    query ListOrders(
      $first: Int!
      $after: String
      $query: String
      $sortKey: OrderSortKeys
      $reverse: Boolean!
    ) {
      orders(first: $first, after: $after, query: $query, sortKey: $sortKey, reverse: $reverse) {
        pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
        edges { node { ...OrderFields } }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    orders: { pageInfo: PageInfo; edges: Array<{ node: OrderNode }> };
  }>(query, variables);

  const flat = flattenConnection(data.orders);
  return {
    items: flat.items.map(shapeOrder),
    pageInfo: flat.pageInfo,
    totalCount: 'unknown' as const,
  };
}

export interface GetOrderInput {
  id: string;
}

export async function getOrder(input: GetOrderInput) {
  const id = buildGid('Order', input.id);
  const query = `
    ${ORDER_FRAGMENT}
    query GetOrder($id: ID!) {
      order(id: $id) { ...OrderFields }
    }
  `;
  const { data } = await shopifyGraphQL<{ order: OrderNode | null }>(query, { id });
  if (!data.order) return { order: null, error: `Order not found: ${id}` };
  return { order: shapeOrder(data.order) };
}

export interface SearchOrdersInput {
  query: string;
  first?: number;
  after?: string;
  sortKey?: OrderSortKey;
  reverse?: boolean;
}

export async function searchOrders(input: SearchOrdersInput) {
  if (!input.query || input.query.trim().length === 0) {
    throw new Error('search_orders requires a non-empty query');
  }
  return listOrders({
    first: input.first,
    after: input.after,
    query: input.query,
    sortKey: input.sortKey ?? 'RELEVANCE',
    reverse: input.reverse,
  });
}

// ---- Write tools ----

export interface MarkOrderPaidInput {
  id: string;
}

export async function markOrderPaid(input: MarkOrderPaidInput) {
  const id = buildGid('Order', input.id);
  const query = `
    ${ORDER_FRAGMENT}
    mutation MarkOrderPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        order { ...OrderFields }
        userErrors { field message }
      }
    }
  `;
  const { data } = await shopifyGraphQL<{
    orderMarkAsPaid: {
      order: OrderNode | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, { input: { id } });

  return {
    order: data.orderMarkAsPaid.order ? shapeOrder(data.orderMarkAsPaid.order) : null,
    userErrors: data.orderMarkAsPaid.userErrors,
  };
}

const VALID_CANCEL_REASONS = ['CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'OTHER', 'STAFF'] as const;
export type CancelOrderReason = (typeof VALID_CANCEL_REASONS)[number];

export interface CancelOrderInput {
  id: string;
  reason?: CancelOrderReason;
  refund?: boolean;
  restock?: boolean;
  notifyCustomer?: boolean;
  staffNote?: string;
  confirm?: boolean;
}

export async function cancelOrder(input: CancelOrderInput) {
  const id = buildGid('Order', input.id);
  const reason: CancelOrderReason = input.reason ?? 'OTHER';
  const refund = input.refund ?? false;
  const restock = input.restock ?? true;

  if (input.confirm !== true) {
    return {
      requiresConfirmation: true,
      action: `Cancel order ${id} with reason=${reason}, refund=${refund}, restock=${restock}. Cancellation runs asynchronously.`,
      hint: 'Pass confirm: true to proceed',
      orderId: id,
    };
  }

  const query = `
    mutation CancelOrder(
      $orderId: ID!
      $reason: OrderCancelReason!
      $refund: Boolean!
      $restock: Boolean!
      $notifyCustomer: Boolean
      $staffNote: String
    ) {
      orderCancel(
        orderId: $orderId
        reason: $reason
        refund: $refund
        restock: $restock
        notifyCustomer: $notifyCustomer
        staffNote: $staffNote
      ) {
        job { id done }
        orderCancelUserErrors { field message code }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    orderCancel: {
      job: { id: string; done: boolean } | null;
      orderCancelUserErrors: Array<{ field: string[] | null; message: string; code: string | null }>;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, {
    orderId: id,
    reason,
    refund,
    restock,
    notifyCustomer: input.notifyCustomer ?? null,
    staffNote: input.staffNote ?? null,
  });

  return {
    job: data.orderCancel.job,
    userErrors: [...data.orderCancel.userErrors, ...data.orderCancel.orderCancelUserErrors],
    note: data.orderCancel.job
      ? 'Cancellation enqueued asynchronously; poll the job by id to confirm completion.'
      : undefined,
  };
}

export interface AddOrderNoteInput {
  id: string;
  note: string;
  mode?: 'append' | 'replace';
}

export async function addOrderNote(input: AddOrderNoteInput) {
  const id = buildGid('Order', input.id);
  if (typeof input.note !== 'string' || input.note.length === 0) {
    throw new Error('add_order_note requires a non-empty note');
  }

  const mode = input.mode ?? 'append';

  let combined = input.note;
  if (mode === 'append') {
    const fetchQuery = `query GetOrderNote($id: ID!) { order(id: $id) { id note } }`;
    const fetched = await shopifyGraphQL<{ order: { id: string; note: string | null } | null }>(
      fetchQuery,
      { id }
    );
    if (!fetched.data.order) {
      return {
        order: null,
        userErrors: [{ field: ['id'], message: `Order not found: ${id}` }],
      };
    }
    const existing = fetched.data.order.note ?? '';
    combined = existing.length > 0 ? `${existing}\n\n${input.note}` : input.note;
  }

  const updateQuery = `
    ${ORDER_FRAGMENT}
    mutation UpdateOrderNote($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { ...OrderFields }
        userErrors { field message }
      }
    }
  `;
  const { data } = await shopifyGraphQL<{
    orderUpdate: {
      order: OrderNode | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(updateQuery, { input: { id, note: combined } });

  return {
    order: data.orderUpdate.order ? shapeOrder(data.orderUpdate.order) : null,
    userErrors: data.orderUpdate.userErrors,
  };
}

function clampFirst(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 1) return 1;
  if (value > 250) return 250;
  return Math.floor(value);
}
