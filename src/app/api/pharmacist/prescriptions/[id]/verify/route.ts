/**
 * src/app/api/pharmacist/prescriptions/[id]/verify/route.ts
 *
 * POST /api/pharmacist/prescriptions/[id]/verify
 * Owner/licensed-pharmacist clinical verification sign-off with NTI & immutability guards.
 */

import { NextRequest } from "next/server";
import { handleVerifyPrescription } from "@/lib/pharmacist/prescription-handlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const rawBody = await request.json().catch(() => null);
  return handleVerifyPrescription(id, rawBody);
}
