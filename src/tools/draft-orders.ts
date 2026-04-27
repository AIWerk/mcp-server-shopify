// Draft order tools: create_draft_order, complete_draft_order.

import { shopifyGraphQL } from '../api.js';
import { buildGid } from '../types.js';

const DRAFT_ORDER_FRAGMENT = `
  fragment DraftOrderFields on DraftOrder {
    id
    name
    status
    invoiceUrl
    note2
    tags
    createdAt
    updatedAt
    completedAt
    customer { id email firstName lastName }
    totalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    totalTaxSet { shopMoney { amount currencyCode } }
    totalShippingPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: 250) {
      pageInfo { hasNextPage hasPreviousPage endCursor startCursor }
      edges {
        node {
          id
          title
          quantity
          sku
          variantTitle
          originalUnitPriceSet { shopMoney { amount currencyCode } }
        }
      }
    }
  }
`;

export interface DraftOrderLineItemInput {
  variantId?: string;
  quantity: number;
  title?: string;
  originalUnitPrice?: string;
  sku?: string;
  requiresShipping?: boolean;
  taxable?: boolean;
}

export interface DraftOrderAddressInput {
  firstName?: string;
  lastName?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  country?: string;
  countryCode?: string;
  zip?: string;
  phone?: string;
  company?: string;
}

export interface CreateDraftOrderInput {
  lineItems: DraftOrderLineItemInput[];
  email?: string;
  customerId?: string;
  note?: string;
  tags?: string[];
  shippingAddress?: DraftOrderAddressInput;
  billingAddress?: DraftOrderAddressInput;
  useCustomerDefaultAddress?: boolean;
}

export async function createDraftOrder(input: CreateDraftOrderInput) {
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    throw new Error('create_draft_order requires at least one line item');
  }
  const lineItems = input.lineItems.map((li) => {
    const out: Record<string, unknown> = { quantity: li.quantity };
    if (li.variantId) out.variantId = buildGid('ProductVariant', li.variantId);
    if (li.title !== undefined) out.title = li.title;
    if (li.originalUnitPrice !== undefined) out.originalUnitPrice = li.originalUnitPrice;
    if (li.sku !== undefined) out.sku = li.sku;
    if (li.requiresShipping !== undefined) out.requiresShipping = li.requiresShipping;
    if (li.taxable !== undefined) out.taxable = li.taxable;
    return out;
  });

  const draftInput: Record<string, unknown> = { lineItems };
  if (input.email !== undefined) draftInput.email = input.email;
  if (input.customerId) draftInput.customerId = buildGid('Customer', input.customerId);
  if (input.note !== undefined) draftInput.note = input.note;
  if (input.tags !== undefined) draftInput.tags = input.tags;
  if (input.shippingAddress) draftInput.shippingAddress = input.shippingAddress;
  if (input.billingAddress) draftInput.billingAddress = input.billingAddress;
  if (input.useCustomerDefaultAddress !== undefined) {
    draftInput.useCustomerDefaultAddress = input.useCustomerDefaultAddress;
  }

  const query = `
    ${DRAFT_ORDER_FRAGMENT}
    mutation CreateDraftOrder($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { ...DraftOrderFields }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    draftOrderCreate: {
      draftOrder: unknown;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, { input: draftInput });

  return data.draftOrderCreate;
}

export interface CompleteDraftOrderInput {
  id: string;
  paymentPending?: boolean;
  confirm?: boolean;
}

export async function completeDraftOrder(input: CompleteDraftOrderInput) {
  const id = buildGid('DraftOrder', input.id);
  const paymentPending = input.paymentPending ?? false;

  if (input.confirm !== true) {
    return {
      requiresConfirmation: true,
      action: `Complete draft order ${id} as ${paymentPending ? 'payment pending' : 'paid'}. This converts the draft into a real order.`,
      hint: 'Pass confirm: true to proceed',
      draftOrderId: id,
    };
  }

  const query = `
    ${DRAFT_ORDER_FRAGMENT}
    mutation CompleteDraftOrder($id: ID!, $paymentPending: Boolean) {
      draftOrderComplete(id: $id, paymentPending: $paymentPending) {
        draftOrder {
          ...DraftOrderFields
          order { id name }
        }
        userErrors { field message }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    draftOrderComplete: {
      draftOrder: unknown;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, { id, paymentPending });

  return data.draftOrderComplete;
}
