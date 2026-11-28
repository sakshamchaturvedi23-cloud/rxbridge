/**
 * src/app/api/pharmacist/demand/route.ts
 *
 * GET /api/pharmacist/demand
 * Returns privacy-safe patient medicine demand feed with live shop stock match.
 */

import { NextRequest } from "next/server";
import { handleListDemand } from "@/lib/pharmacist/demand-handlers";

export async function GET(request: NextRequest) {
  return handleListDemand(request.nextUrl.searchParams);
}
