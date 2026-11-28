/**
 * src/app/api/pharmacist/dashboard/route.ts
 *
 * GET /api/pharmacist/dashboard
 * Returns real DB-persisted KPIs, low-stock alerts, and unread notification count
 * scoped strictly to the authenticated pharmacist's shop.
 */

import { handleGetPharmacistDashboard } from "@/lib/pharmacist/onboarding-handlers";

export async function GET() {
  return handleGetPharmacistDashboard();
}
