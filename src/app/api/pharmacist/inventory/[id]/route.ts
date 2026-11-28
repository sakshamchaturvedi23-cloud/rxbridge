/**
 * src/app/api/pharmacist/inventory/[id]/route.ts
 *
 * GET /api/pharmacist/inventory/[id]    - Fetch single owned inventory item
 * PATCH /api/pharmacist/inventory/[id]  - Update metadata/pricing or atomically adjust stock
 * DELETE /api/pharmacist/inventory/[id] - Soft-archive inventory item with movement log
 */

import { NextRequest } from "next/server";
import {
  handleArchiveInventoryById,
  handleGetInventoryById,
  handlePatchInventoryById,
} from "@/lib/pharmacist/inventory-handlers";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleGetInventoryById(id);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const rawBody = await request.json().catch(() => null);
  return handlePatchInventoryById(id, rawBody);
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleArchiveInventoryById(id);
}
