/**
 * src/app/api/pharmacist/prescriptions/route.ts
 *
 * GET /api/pharmacist/prescriptions
 * Lists prescription verifications scoped strictly to the authenticated shop.
 */

import { NextRequest } from "next/server";
import { handleListPrescriptions } from "@/lib/pharmacist/prescription-handlers";

export async function GET(request: NextRequest) {
  return handleListPrescriptions(request.nextUrl.searchParams);
}
