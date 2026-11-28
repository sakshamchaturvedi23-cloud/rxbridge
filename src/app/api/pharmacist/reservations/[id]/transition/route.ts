/**
 * src/app/api/pharmacist/reservations/[id]/transition/route.ts
 *
 * POST /api/pharmacist/reservations/[id]/transition
 * Enforces fulfilment state machine, Schedule H gate, and atomic Postgres FOR UPDATE stock RPCs.
 */

import { NextRequest } from "next/server";
import { handleTransitionReservation } from "@/lib/pharmacist/reservation-handlers";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const rawBody = await request.json().catch(() => null);
  return handleTransitionReservation(id, rawBody);
}
