/**
 * src/app/api/pharmacist/prescriptions/[id]/route.ts
 *
 * GET /api/pharmacist/prescriptions/[id]
 * Loads read-only prescription items, clinical safety flags, NTI locks, and audit notes.
 */

import { NextRequest } from "next/server";
import { handleGetPrescriptionDetail } from "@/lib/pharmacist/prescription-handlers";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleGetPrescriptionDetail(id);
}
