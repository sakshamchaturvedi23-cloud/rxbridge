/**
 * src/app/api/safety/route.ts
 *
 * POST /api/safety
 *
 * Evaluates prescribed or selected medicines against:
 * - NTI (Narrow Therapeutic Index) Do-Not-Substitute restrictions
 * - Schedule H / H1 prescription requirements
 * - Authenticated patient's profile (allergies, chronic_conditions, current_meds)
 * - Curated intra-prescription and current-medication drug interactions
 *
 * Security:
 * - Uses authenticated cookie-based Supabase client (`createClient()`) only; respects RLS.
 * - Never exposes or reads another patient's profile.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  evaluatePrescriptionSafety,
  type SafetyMedicineInput,
} from "@/lib/clinical/safety-check";

const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const safetyMedicineItemSchema = z.object({
  temp_id: z.string().min(1).optional(),
  medicine_id: z.string().nullable().optional(),
  brand_name: z.string().min(1, "brand_name is required"),
  composition_display: z.string().nullable().optional(),
  composition_key: z.string().nullable().optional(),
  is_nti: z.boolean().optional(),
  is_schedule_h: z.boolean().optional(),
});

const safetyRequestSchema = z.object({
  items: z
    .array(safetyMedicineItemSchema)
    .min(1, "At least one medicine item is required")
    .max(50, "Maximum 50 medicine items per safety check"),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate caller using cookie-based Supabase client (strict RLS)
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Validate request body
    const body = await request.json().catch(() => null);
    const parsed = safetyRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: parsed.error.format() },
        { status: 400 }
      );
    }

    const rawItems = parsed.data.items;

    // 3. Hydrate authoritative medicine metadata from Supabase for valid UUID medicine_ids
    const validMedicineIds = Array.from(
      new Set(
        rawItems
          .map((item) => item.medicine_id)
          .filter((id): id is string => typeof id === "string" && uuidRegex.test(id))
      )
    );

    const dbMedicineMap = new Map<
      string,
      {
        id: string;
        brand_name: string;
        composition_display: string;
        composition_key: string;
        is_nti: boolean;
        is_schedule_h: boolean;
      }
    >();

    if (validMedicineIds.length > 0) {
      const { data: dbMeds, error: medsError } = await supabase
        .from("medicines")
        .select("id, brand_name, composition_display, composition_key, is_nti, is_schedule_h")
        .in("id", validMedicineIds);

      if (medsError) {
        return NextResponse.json(
          { error: `Failed to verify medicines: ${medsError.message}` },
          { status: 500 }
        );
      }

      for (const med of dbMeds ?? []) {
        dbMedicineMap.set(med.id, med);
      }
    }

    const hydratedItems: SafetyMedicineInput[] = rawItems.map((item, idx) => {
      const dbMed = item.medicine_id ? dbMedicineMap.get(item.medicine_id) : undefined;
      return {
        temp_id: item.temp_id || `item-${idx + 1}`,
        medicine_id: dbMed?.id ?? item.medicine_id ?? null,
        brand_name: dbMed?.brand_name || item.brand_name,
        composition_display: dbMed?.composition_display ?? item.composition_display ?? null,
        composition_key: dbMed?.composition_key ?? item.composition_key ?? null,
        is_nti: Boolean(dbMed?.is_nti || item.is_nti),
        is_schedule_h: Boolean(dbMed?.is_schedule_h || item.is_schedule_h),
      };
    });

    // 4. Load authenticated patient's own clinical profile via RLS
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("allergies, chronic_conditions, current_meds")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { error: `Failed to load patient safety profile: ${profileError.message}` },
        { status: 500 }
      );
    }

    // 5. Evaluate clinical safety deterministically
    const report = evaluatePrescriptionSafety(hydratedItems, {
      allergies: profile?.allergies ?? [],
      chronic_conditions: profile?.chronic_conditions ?? [],
      current_meds: profile?.current_meds ?? [],
    });

    return NextResponse.json({
      items: report.items,
      flags: report.all_flags,
      summary: report.summary,
      disclaimers: report.disclaimers,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Internal safety check error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
