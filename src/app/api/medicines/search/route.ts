/**
 * src/app/api/medicines/search/route.ts
 *
 * GET /api/medicines/search
 *
 * Query Parameters:
 * - q: Search query string (type-ahead search on brand_name or composition_display)
 * - medicine_id: UUID of a confirmed medicine to fetch same-salt alternatives grouped into:
 *     - lowerPriceAlternatives (cheaper non-Jan Aushadhi branded alternatives, sorted cheapest first)
 *     - janAushadhiOptions (PMBI generic alternatives, sorted cheapest first)
 *     - otherSameSaltBrands (same-salt reference options, equal/higher price)
 * - enforce_nti_lock: "true" | "false" (defaults to "true" to lock Do-Not-Substitute for NTI medicines)
 * - limit: Number of type-ahead search results (default 20, max 50)
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  searchMedicines,
  searchMedicineWithAlternatives,
  type MedicineSearchItem,
  type SameSaltAlternativesGroup,
} from "@/lib/clinical/medicine-search";

export interface MedicineSearchApiResponse {
  medicines?: MedicineSearchItem[];
  medicine?: MedicineSearchItem;
  groups?: SameSaltAlternativesGroup;
}

const medicineIdSchema = z.string().uuid({
  message: "Invalid medicine_id format. Must be a valid UUID.",
});

export async function GET(request: NextRequest) {
  try {
    // 1. Resolve Supabase client: prefer authenticated session, fallback to admin for public catalog search
    let supabase;
    try {
      const supabaseUserClient = await createClient();
      const {
        data: { user },
      } = await supabaseUserClient.auth.getUser();
      supabase = user ? supabaseUserClient : createAdminClient();
    } catch {
      supabase = createAdminClient();
    }

    // 2. Parse query parameters
    const { searchParams } = request.nextUrl;
    const qParam = searchParams.get("q")?.trim() || null;
    const medicineIdParam = searchParams.get("medicine_id")?.trim() || null;
    const enforceNtiParam = searchParams.get("enforce_nti_lock");
    const limitParam = searchParams.get("limit");

    const enforceNtiLock = enforceNtiParam !== "false";
    const limit = limitParam ? Number.parseInt(limitParam, 10) : 20;

    if (!qParam && !medicineIdParam) {
      return NextResponse.json(
        { error: "Provide either 'q' or 'medicine_id' query parameter" },
        { status: 400 }
      );
    }

    const response: MedicineSearchApiResponse = {};

    // 3. Process medicine_id if provided (Mode: Same-salt grouping)
    if (medicineIdParam) {
      const parsed = medicineIdSchema.safeParse(medicineIdParam);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message || "Invalid medicine_id UUID" },
          { status: 400 }
        );
      }

      const result = await searchMedicineWithAlternatives(supabase, parsed.data, {
        enforceNtiLock,
      });

      if (!result) {
        return NextResponse.json(
          { error: "Medicine not found with the provided ID" },
          { status: 404 }
        );
      }

      response.medicine = result.medicine;
      response.groups = result.groups;
    }

    // 4. Process q if provided (Mode: Type-ahead search)
    if (qParam) {
      const searchResults = await searchMedicines(supabase, qParam, {
        limit: Number.isNaN(limit) ? 20 : limit,
      });
      response.medicines = searchResults;
    }

    return NextResponse.json(response);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Internal search error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
