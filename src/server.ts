#!/usr/bin/env node
// Shopify Admin API MCP server.

import { readFileSync, realpathSync } from 'fs';
import { fileURLToPath } from 'node:url';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import {
  addProductTag,
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  removeProductTag,
  searchProducts,
  updateProduct,
} from './tools/products.js';
import {
  addOrderNote,
  cancelOrder,
  getOrder,
  listOrders,
  markOrderPaid,
  searchOrders,
} from './tools/orders.js';
import {
  addCustomerNote,
  createCustomer,
  getCustomer,
  listCustomers,
  searchCustomers,
  updateCustomer,
} from './tools/customers.js';
import { adjustInventoryLevel, getInventoryLevel } from './tools/inventory.js';
import { completeDraftOrder, createDraftOrder } from './tools/draft-orders.js';
import { getShopInfo, listCollections, listLocations, listMetafields } from './tools/shop.js';

function readPackageVersion(): string {
  if (!import.meta.url) return '0.0.0-sandbox';
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
    ) as { version: string };
    return pkg.version;
  } catch {
    try {
      const pkg = JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')
      ) as { version: string };
      return pkg.version;
    } catch {
      return '0.0.0-sandbox';
    }
  }
}

const VERSION = readPackageVersion();

function toolSuccess(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function toolError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text' as const, text: message }] };
}

const PRODUCT_SORT_KEYS = [
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

const ORDER_SORT_KEYS = [
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

const CANCEL_REASONS = ['CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'OTHER', 'STAFF'] as const;

const CUSTOMER_SORT_KEYS = [
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

const METAFIELD_OWNER_TYPES = [
  'PRODUCT',
  'PRODUCTVARIANT',
  'CUSTOMER',
  'ORDER',
  'COLLECTION',
  'SHOP',
  'COMPANY',
  'LOCATION',
] as const;

export function createServer() {
  const server = new McpServer({
    name: '@aiwerk/mcp-server-shopify',
    version: VERSION,
  });

  // ---- Products (read) ----

  server.registerTool(
    'shopify_list_products',
    {
      description:
        'List products with optional Shopify search query syntax (e.g. "status:active vendor:Acme"). Optional pagination via cursor. Default first=50, max=250.',
      inputSchema: {
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        query: z.string().optional(),
        sortKey: z.enum(PRODUCT_SORT_KEYS).optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await listProducts(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_get_product',
    {
      description:
        'Get a product by GID or numeric ID (e.g. "gid://shopify/Product/123" or "123"). Returns full product detail including variants and images, with truncation markers when capped.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await getProduct(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_search_products',
    {
      description:
        'Search products by Shopify search query (full-text + filters like "title:T-Shirt status:active"). Required: query. Optional pagination + sort.',
      inputSchema: {
        query: z.string().min(1),
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        sortKey: z.enum(PRODUCT_SORT_KEYS).optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await searchProducts(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Products (write) ----

  server.registerTool(
    'shopify_create_product',
    {
      description:
        'Create a new product. Required: title. Optional: descriptionHtml, productType, vendor, tags, status (ACTIVE|ARCHIVED|DRAFT, default ACTIVE), handle. Returns product + userErrors.',
      inputSchema: {
        title: z.string().min(1),
        descriptionHtml: z.string().optional(),
        productType: z.string().optional(),
        vendor: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']).optional(),
        handle: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await createProduct(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_update_product',
    {
      description:
        'Update fields on an existing product by GID or numeric ID. Required: id. All other fields are optional and only applied if provided. Returns product + userErrors.',
      inputSchema: {
        id: z.string().min(1),
        title: z.string().optional(),
        descriptionHtml: z.string().optional(),
        productType: z.string().optional(),
        vendor: z.string().optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(['ACTIVE', 'ARCHIVED', 'DRAFT']).optional(),
        handle: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await updateProduct(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_archive_product',
    {
      description:
        'Archive a product (sets status to ARCHIVED, hiding it from sale). Reversible. Destructive: requires confirm=true. Without confirm, returns a structured "would do X" response without firing.',
      inputSchema: {
        id: z.string().min(1),
        confirm: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await archiveProduct(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_add_product_tag',
    {
      description:
        'Add one or more tags to a product. Required: productId, tags (non-empty array). Idempotent server-side. Returns the updated product node + userErrors.',
      inputSchema: {
        productId: z.string().min(1),
        tags: z.array(z.string().min(1)).min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await addProductTag(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_remove_product_tag',
    {
      description:
        'Remove one or more tags from a product. Required: productId, tags (non-empty array). Returns the updated product node + userErrors.',
      inputSchema: {
        productId: z.string().min(1),
        tags: z.array(z.string().min(1)).min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await removeProductTag(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Orders (read) ----

  server.registerTool(
    'shopify_list_orders',
    {
      description:
        'List orders with optional Shopify search query (e.g. "financial_status:paid created_at:>2026-01-01"). Default first=50, max=250.',
      inputSchema: {
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        query: z.string().optional(),
        sortKey: z.enum(ORDER_SORT_KEYS).optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await listOrders(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_get_order',
    {
      description:
        'Get a single order by GID or numeric ID. Returns full detail including line items (with truncation marker), customer, addresses, and financial totals.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await getOrder(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_search_orders',
    {
      description:
        'Search orders by Shopify search query (e.g. "name:#1001 OR email:foo@bar.com"). Required: query.',
      inputSchema: {
        query: z.string().min(1),
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        sortKey: z.enum(ORDER_SORT_KEYS).optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await searchOrders(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Orders (write) ----

  server.registerTool(
    'shopify_mark_order_paid',
    {
      description:
        'Mark an order as paid (orderMarkAsPaid). Use for offline payments where the funds were captured outside Shopify. Returns updated order + userErrors.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await markOrderPaid(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_cancel_order',
    {
      description:
        'Cancel an order asynchronously (orderCancel returns a job). Destructive: requires confirm=true. Default reason=OTHER, restock=true, refund=false, notifyCustomer omitted.',
      inputSchema: {
        id: z.string().min(1),
        reason: z.enum(CANCEL_REASONS).optional(),
        refund: z.boolean().optional(),
        restock: z.boolean().optional(),
        notifyCustomer: z.boolean().optional(),
        staffNote: z.string().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await cancelOrder(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_add_order_note',
    {
      description:
        'Add a note to an order. mode=append (default) reads the current note and concatenates with two newlines; mode=replace overwrites. Required: id, note. Append makes one extra read query.',
      inputSchema: {
        id: z.string().min(1),
        note: z.string().min(1),
        mode: z.enum(['append', 'replace']).optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await addOrderNote(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Customers (read) ----

  server.registerTool(
    'shopify_list_customers',
    {
      description:
        'List customers with optional Shopify search query (e.g. "orders_count:>0 country:CH"). Default first=50, max=250.',
      inputSchema: {
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        query: z.string().optional(),
        sortKey: z.enum(CUSTOMER_SORT_KEYS).optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await listCustomers(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_get_customer',
    {
      description:
        'Get a single customer by GID or numeric ID. Returns full detail including default address, addresses (with truncation marker), tags, locale, and lifetime value.',
      inputSchema: {
        id: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await getCustomer(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_search_customers',
    {
      description:
        'Search customers by Shopify search query (e.g. "email:foo@bar.com OR last_name:Smith"). Required: query.',
      inputSchema: {
        query: z.string().min(1),
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        sortKey: z.enum(CUSTOMER_SORT_KEYS).optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await searchCustomers(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Customers (write) ----

  server.registerTool(
    'shopify_create_customer',
    {
      description:
        'Create a customer (customerCreate). At least one of email/phone is required. Optional: firstName, lastName, note, tags, locale.',
      inputSchema: {
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional(),
        locale: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await createCustomer(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_update_customer',
    {
      description:
        'Update a customer (customerUpdate). Required: id. All other fields are optional and only applied if provided.',
      inputSchema: {
        id: z.string().min(1),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional(),
        locale: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await updateCustomer(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_add_customer_note',
    {
      description:
        'Add a note to a customer. mode=append (default) reads the current note and concatenates with two newlines; mode=replace overwrites. Append makes one extra read query.',
      inputSchema: {
        id: z.string().min(1),
        note: z.string().min(1),
        mode: z.enum(['append', 'replace']).optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await addCustomerNote(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Inventory ----

  server.registerTool(
    'shopify_get_inventory_level',
    {
      description:
        'Get the inventory level (available, on_hand, committed, incoming, reserved) for an inventory item at a single location. Required: inventoryItemId, locationId.',
      inputSchema: {
        inventoryItemId: z.string().min(1),
        locationId: z.string().min(1),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await getInventoryLevel(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_adjust_inventory_level',
    {
      description:
        'Adjust the available or on_hand quantity at a location by a delta (positive or negative integer, non-zero). Uses inventoryAdjustQuantities. Defaults: name=available, reason=correction. Optional: referenceDocumentUri.',
      inputSchema: {
        inventoryItemId: z.string().min(1),
        locationId: z.string().min(1),
        delta: z.number().int(),
        name: z.enum(['available', 'on_hand']).optional(),
        reason: z.string().optional(),
        referenceDocumentUri: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await adjustInventoryLevel(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Draft orders ----

  server.registerTool(
    'shopify_create_draft_order',
    {
      description:
        'Create a draft order. Required: lineItems (non-empty). Each line item needs quantity, plus either variantId (existing variant) or title+originalUnitPrice (custom item). Optional: email, customerId, note, tags, shippingAddress, billingAddress, useCustomerDefaultAddress.',
      inputSchema: {
        lineItems: z.array(
          z.object({
            variantId: z.string().optional(),
            quantity: z.number().int().positive(),
            title: z.string().optional(),
            originalUnitPrice: z.string().optional(),
            sku: z.string().optional(),
            requiresShipping: z.boolean().optional(),
            taxable: z.boolean().optional(),
          }).refine(
            (li) => Boolean(li.variantId) || (Boolean(li.title) && Boolean(li.originalUnitPrice)),
            { message: 'Each line item needs either variantId, or both title and originalUnitPrice (custom item)' }
          )
        ).min(1),
        email: z.string().optional(),
        customerId: z.string().optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional(),
        shippingAddress: z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          province: z.string().optional(),
          country: z.string().optional(),
          countryCode: z.string().optional(),
          zip: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
        }).optional(),
        billingAddress: z.object({
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          address1: z.string().optional(),
          address2: z.string().optional(),
          city: z.string().optional(),
          province: z.string().optional(),
          country: z.string().optional(),
          countryCode: z.string().optional(),
          zip: z.string().optional(),
          phone: z.string().optional(),
          company: z.string().optional(),
        }).optional(),
        useCustomerDefaultAddress: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await createDraftOrder(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_complete_draft_order',
    {
      description:
        'Complete a draft order, converting it into a real order (draftOrderComplete). Destructive: requires confirm=true. paymentPending=true marks the resulting order as payment pending instead of paid.',
      inputSchema: {
        id: z.string().min(1),
        paymentPending: z.boolean().optional(),
        confirm: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await completeDraftOrder(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // ---- Shop / collections / locations / metafields ----

  server.registerTool(
    'shopify_get_shop_info',
    {
      description:
        'Get shop-level metadata: name, primary domain, currency, timezone, plan, billing address, contact email, weight unit.',
      inputSchema: {},
    },
    async () => {
      try {
        return toolSuccess(await getShopInfo());
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_list_collections',
    {
      description:
        'List collections with optional Shopify search query. Returns id, title, handle, descriptionHtml, sortOrder, productsCount.',
      inputSchema: {
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        query: z.string().optional(),
        reverse: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await listCollections(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_list_locations',
    {
      description:
        'List shop locations (warehouses, retail stores). By default excludes inactive and legacy locations; toggle with includeInactive / includeLegacy.',
      inputSchema: {
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        includeInactive: z.boolean().optional(),
        includeLegacy: z.boolean().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await listLocations(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'shopify_list_metafields',
    {
      description:
        'List metafields on any HasMetafields resource (Product, ProductVariant, Customer, Order, Collection, Shop, Company, Location). Required: ownerId, ownerType. Optional: namespace filter.',
      inputSchema: {
        ownerId: z.string().min(1),
        ownerType: z.enum(METAFIELD_OWNER_TYPES),
        first: z.number().int().min(1).max(250).optional(),
        after: z.string().optional(),
        namespace: z.string().optional(),
      },
    },
    async (args) => {
      try {
        return toolSuccess(await listMetafields(args));
      } catch (err) {
        return toolError(err);
      }
    }
  );

  return {
    server,
    close: async () => {
      await server.close();
    },
  };
}

export default function createSandboxServer() {
  return createServer().server;
}

export { createSandboxServer };

async function main() {
  const { server, close } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

export function isCliEntry(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argv1);
  } catch {
    return false;
  }
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
