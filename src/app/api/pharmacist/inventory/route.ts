/**
 * src/app/api/pharmacist/inventory/route.ts
 *
 * GET /api/pharmacist/inventory  - List & filter shop inventory with computed ATP & status
 * POST /api/pharmacist/inventory - Add catalog-linked or manual/unlinked inventory item
 */

import { NextRequest } from "next/server";
import {
  handleCreateInventory,
  handleListInventory,
} from "@/lib/pharmacist/inventory-handlers";

export async function GET(request: NextRequest) {
  return handleListInventory(request.nextUrl.searchParams);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  return handleCreateInventory(rawBody);
}
