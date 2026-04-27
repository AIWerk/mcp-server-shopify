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
