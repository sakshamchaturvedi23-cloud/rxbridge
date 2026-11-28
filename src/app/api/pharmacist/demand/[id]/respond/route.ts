/**
 * src/app/api/pharmacist/demand/[id]/respond/route.ts
 *
 * POST /api/pharmacist/demand/[id]/respond
 * Records a verified pharmacy's availability response for a patient demand request.
 */

import { NextRequest } from "next/server";
import { handleRespondToDemand } from "@/lib/pharmacist/demand-handlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const rawBody = await request.json().catch(() => null);
  return handleRespondToDemand(id, rawBody);
}
