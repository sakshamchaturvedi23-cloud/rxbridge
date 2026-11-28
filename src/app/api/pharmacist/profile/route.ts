/**
 * src/app/api/pharmacist/profile/route.ts
 *
 * GET /api/pharmacist/profile  - Load shop onboarding status, details & member roster
 * PATCH /api/pharmacist/profile - Owner-only update of editable pharmacy details
 */

import { NextRequest } from "next/server";
import {
  handleGetPharmacistProfile,
  handlePatchPharmacistProfile,
} from "@/lib/pharmacist/onboarding-handlers";

export async function GET() {
  return handleGetPharmacistProfile();
}

export async function PATCH(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  return handlePatchPharmacistProfile(rawBody);
}
