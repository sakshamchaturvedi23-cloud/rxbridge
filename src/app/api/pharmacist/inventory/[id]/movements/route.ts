/**
 * src/app/api/pharmacist/inventory/[id]/movements/route.ts
 *
 * GET /api/pharmacist/inventory/[id]/movements
 * Returns ordered immutable audit ledger entries for a shop-owned inventory item.
 */

import { NextRequest } from "next/server";
import { handleGetInventoryMovements } from "@/lib/pharmacist/inventory-handlers";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleGetInventoryMovements(id);
}
