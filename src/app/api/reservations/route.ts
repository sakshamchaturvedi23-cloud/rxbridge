/**
 * src/app/api/reservations/route.ts
 *
 * POST /api/reservations
 * Patient-side integration bridge matching `CreateReservationRequest` in `src/types/contracts.ts`.
 */

import { NextRequest } from "next/server";
import { handleCreatePatientReservation } from "@/lib/pharmacist/reservation-handlers";

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  return handleCreatePatientReservation(rawBody);
}
