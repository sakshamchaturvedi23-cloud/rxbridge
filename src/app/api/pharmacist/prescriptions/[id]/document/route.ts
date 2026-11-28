/**
 * src/app/api/pharmacist/prescriptions/[id]/document/route.ts
 *
 * GET /api/pharmacist/prescriptions/[id]/document
 * Generates a 300s signed URL via server-only createAdminClient() after verifying authorization.
 */

import { NextRequest } from "next/server";
import { handleGetPrescriptionDocument } from "@/lib/pharmacist/prescription-handlers";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleGetPrescriptionDocument(id);
}
