/**
 * src/app/api/pharmacist/reservations/route.ts
 *
 * GET /api/pharmacist/reservations
 * Lists incoming reservations scoped strictly to the authenticated pharmacist's shop.
 */

import { NextRequest } from "next/server";
import { handleListPharmacistReservations } from "@/lib/pharmacist/reservation-handlers";

export async function GET(request: NextRequest) {
  return handleListPharmacistReservations(request.nextUrl.searchParams);
}
