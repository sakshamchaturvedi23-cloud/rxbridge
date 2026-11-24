import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type MedicineRow = Database["public"]["Tables"]["medicines"]["Row"];

export interface SearchAlternativeItem extends MedicineRow {
  savings: number;
  savings_pct: number;
}

export interface SearchAlternativesResponse {
  medicine: MedicineRow;
  nti_locked: boolean;
  substitution_blocked_reason: string | null;
  alternatives: SearchAlternativeItem[];
}

export interface SearchTextResponse {
  medicines: MedicineRow[];
}

const medicineIdSchema = z.string().uuid({
  message: "Invalid medicine_id format. Must be a valid UUID.",
});

/**
 * Sanitizes search input to prevent PostgREST .or() filter syntax breakage.
 * Strips commas, parentheses, colons, quotes, and structural filter characters.
 */
function sanitizeSearchQuery(input: string): string {
  return input
    .replace(/[(),":\\;.[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * GET /api/search
 *
 * Query params:
 * - q: text search query (brand name or composition display)
 * - medicine_id: UUID of a medicine to fetch same-salt alternatives
 *
 * Modes:
 * - Mode A: Text Search (?q=<query>)
 * - Mode B: Same-Salt Alternatives (?medicine_id=<uuid>)
 */
export async function GET(request: NextRequest) {
  // 1. Authenticate user session via cookie-based Supabase client
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse query parameters
  const { searchParams } = request.nextUrl;
  const qParam = searchParams.get("q");
  const q = qParam ? qParam.trim() : null;
  const medIdParam = searchParams.get("medicine_id");
  const medicineId = medIdParam ? medIdParam.trim() : null;

  if (!q && !medicineId) {
    return NextResponse.json(
      { error: "Provide either 'q' or 'medicine_id'" },
      { status: 400 }
    );
  }

  // --------------------------------------------------------------------------
  // Mode B: Same-Salt Alternatives (medicine_id provided)
  // --------------------------------------------------------------------------
  if (medicineId) {
    const parseResult = medicineIdSchema.safeParse(medicineId);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: parseResult.error.issues[0]?.message || "Invalid medicine_id UUID" },
        { status: 400 }
      );
    }

    const validId = parseResult.data;

    // Fetch the target medicine
    const { data: medicine, error: medicineError } = await supabase
      .from("medicines")
      .select("*")
      .eq("id", validId)
      .maybeSingle();

    if (medicineError) {
      return NextResponse.json({ error: medicineError.message }, { status: 500 });
    }

    if (!medicine) {
      return NextResponse.json({ error: "Medicine not found" }, { status: 404 });
    }

    // NTI Clinical Safety Lock: Strict Do-Not-Substitute rule
    if (medicine.is_nti) {
      const response: SearchAlternativesResponse = {
        medicine,
        nti_locked: true,
        substitution_blocked_reason:
          "Narrow Therapeutic Index drug — do not substitute without doctor approval",
        alternatives: [],
      };
      return NextResponse.json(response);
    }

    // Non-NTI: Query other medicines with the exact same composition_key
    const { data: altRows, error: altError } = await supabase
      .from("medicines")
      .select("*")
      .eq("composition_key", medicine.composition_key)
      .neq("id", medicine.id)
      .order("mrp", { ascending: true });

    if (altError) {
      return NextResponse.json({ error: altError.message }, { status: 500 });
    }

    const alternatives: SearchAlternativeItem[] = (altRows ?? []).map((alt) => {
      const rawSavings = medicine.mrp - alt.mrp;
      const savings = Math.max(0, Number(rawSavings.toFixed(2)));
      const savings_pct =
        medicine.mrp > 0
          ? Number((((medicine.mrp - alt.mrp) / medicine.mrp) * 100).toFixed(1))
          : 0;

      return {
        ...alt,
        savings,
        savings_pct,
      };
    });

    const response: SearchAlternativesResponse = {
      medicine,
      nti_locked: false,
      substitution_blocked_reason: null,
      alternatives,
    };

    return NextResponse.json(response);
  }

  // --------------------------------------------------------------------------
  // Mode A: Text Search (q provided, no medicine_id)
  // --------------------------------------------------------------------------
  const sanitizedQ = sanitizeSearchQuery(q!);

  if (!sanitizedQ) {
    const emptyResponse: SearchTextResponse = { medicines: [] };
    return NextResponse.json(emptyResponse);
  }

  const { data: medicines, error: searchError } = await supabase
    .from("medicines")
    .select("*")
    .or(
      `brand_name.ilike.%${sanitizedQ}%,composition_display.ilike.%${sanitizedQ}%`
    )
    .order("mrp", { ascending: true })
    .limit(15);

  if (searchError) {
    return NextResponse.json({ error: searchError.message }, { status: 500 });
  }

  const response: SearchTextResponse = {
    medicines: medicines ?? [],
  };

  return NextResponse.json(response);
}
