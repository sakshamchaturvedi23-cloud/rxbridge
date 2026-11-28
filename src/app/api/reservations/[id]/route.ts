/**
 * src/app/api/reservations/[id]/route.ts
 *
 * GET /api/reservations/[id]
 * Patient-authenticated read of reservation status, line items, and transition history.
 */

import { NextRequest } from "next/server";
import { handleGetPatientReservation } from "@/lib/pharmacist/reservation-handlers";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  return handleGetPatientReservation(id);
}
