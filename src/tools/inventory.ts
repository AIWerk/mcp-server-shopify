// Inventory tools: get_inventory_level, adjust_inventory_level.
// inventoryAdjustQuantities is the modern mutation (replaces the legacy
// inventoryAdjustQuantity). Reason is required by Shopify; we default to
// "correction". The mutation also requires the @idempotent directive with a
// per-call key, plus a changeFromQuantity for optimistic concurrency.

import { randomUUID } from 'node:crypto';
import { shopifyGraphQL } from '../api.js';
import { buildGid } from '../types.js';

export interface GetInventoryLevelInput {
  inventoryItemId: string;
  locationId: string;
}

export async function getInventoryLevel(input: GetInventoryLevelInput) {
  const inventoryItemId = buildGid('InventoryItem', input.inventoryItemId);
  const locationId = buildGid('Location', input.locationId);

  const query = `
    query GetInventoryLevel($inventoryItemId: ID!, $locationId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        id
        sku
        tracked
        variant { id title sku }
        inventoryLevel(locationId: $locationId) {
          id
          location { id name }
          quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) {
            name
            quantity
          }
        }
      }
    }
  `;

  const { data } = await shopifyGraphQL<{
    inventoryItem: {
      id: string;
      sku: string | null;
      tracked: boolean;
      variant: { id: string; title: string; sku: string | null } | null;
      inventoryLevel: {
        id: string;
        location: { id: string; name: string };
        quantities: Array<{ name: string; quantity: number }>;
      } | null;
    } | null;
  }>(query, { inventoryItemId, locationId });

  if (!data.inventoryItem) {
    return { inventoryItem: null, error: `Inventory item not found: ${inventoryItemId}` };
  }
  if (!data.inventoryItem.inventoryLevel) {
    return {
      inventoryItem: null,
      error: `No inventory level for item ${inventoryItemId} at location ${locationId}`,
    };
  }
  return { inventoryItem: data.inventoryItem };
}

export interface AdjustInventoryLevelInput {
  inventoryItemId: string;
  locationId: string;
  delta: number;
  reason?: string;
  name?: 'available' | 'on_hand';
  referenceDocumentUri?: string;
}

export async function adjustInventoryLevel(input: AdjustInventoryLevelInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error('adjust_inventory_level requires a non-zero integer delta');
  }
  const inventoryItemId = buildGid('InventoryItem', input.inventoryItemId);
  const locationId = buildGid('Location', input.locationId);
  const reason = input.reason ?? 'correction';
  const name = input.name ?? 'available';

  // The modern InventoryChangeInput requires changeFromQuantity for optimistic
  // concurrency control. Fetch the current quantity first, then submit the delta.
  const currentQuery = `
    query CurrentQty($inventoryItemId: ID!, $locationId: ID!, $name: String!) {
      inventoryItem(id: $inventoryItemId) {
        inventoryLevel(locationId: $locationId) {
          quantities(names: [$name]) { name quantity }
        }
      }
    }
  `;
  const cur = await shopifyGraphQL<{
    inventoryItem: {
      inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
    } | null;
  }>(currentQuery, { inventoryItemId, locationId, name });

  const currentQty = cur.data.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity;
  if (typeof currentQty !== 'number') {
    return {
      adjustment: null,
      userErrors: [{
        field: ['inventoryItemId', 'locationId'],
        message: `Inventory level not found for item ${inventoryItemId} at ${locationId}`,
      }],
    };
  }

  const idempotencyKey = randomUUID();
  const query = `
    mutation AdjustInventory($input: InventoryAdjustQuantitiesInput!, $idempotencyKey: String!) {
      inventoryAdjustQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          id
          createdAt
          reason
          referenceDocumentUri
          changes { name delta quantityAfterChange location { id name } }
        }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    input: {
      reason,
      name,
      ...(input.referenceDocumentUri ? { referenceDocumentUri: input.referenceDocumentUri } : {}),
      changes: [{
        delta: input.delta,
        inventoryItemId,
        locationId,
        changeFromQuantity: currentQty,
      }],
    },
    idempotencyKey,
  };

  const { data } = await shopifyGraphQL<{
    inventoryAdjustQuantities: {
      inventoryAdjustmentGroup: {
        id: string;
        createdAt: string;
        reason: string;
        referenceDocumentUri: string | null;
        changes: Array<{
          name: string;
          delta: number;
          quantityAfterChange: number;
          location: { id: string; name: string };
        }>;
      } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(query, variables);

  return {
    adjustment: data.inventoryAdjustQuantities.inventoryAdjustmentGroup,
    userErrors: data.inventoryAdjustQuantities.userErrors,
  };
}
